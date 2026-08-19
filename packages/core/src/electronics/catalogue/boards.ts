/**
 * The boards everything else hangs off.
 *
 * Pin maps are the official pinouts, and the two facts worth checking in each
 * entry are which pins do PWM and which can raise an interrupt — those are the
 * ones the rules engine refuses a wire over, and the ones a datasheet reader
 * would come here to verify.
 *
 * `supply` is the RECOMMENDED input range through the board's own regulator, not
 * the absolute maximum: 7–12 V for an UNO rather than the 6–20 V the datasheet
 * tolerates, because a board run at 6 V browns out under load and one run at
 * 20 V cooks its regulator, and a catalogue that reported the tolerance would be
 * inviting both. `current.typical` is the board idling; `peak` is the board plus
 * what its rails are rated to hand out, which is the number a current budget has
 * to work against.
 */

import type { ComponentDef } from "../component.js";
import { analog, digital, gnd, pin, powerOut, through } from "./pins.js";

export const BOARDS: readonly ComponentDef[] = [
  {
    id: "arduino-uno",
    kind: "board",
    name: "Arduino UNO R3",
    summary: "Osnovna ploča sa ATmega328P — 14 digitalnih i 6 analognih pinova.",
    supply: { min: 7, max: 12 },
    current: { typical: 45, peak: 200 },
    logicVolts: 5,
    buses: [
      { kind: "i2c", addresses: [] },
      { kind: "spi" },
      { kind: "uart", baud: 9600 },
    ],
    pins: [
      pin("VIN", ["power-in"], undefined, "VIN"),
      powerOut("5V", 5),
      powerOut("3V3", 3.3, "3.3V"),
      gnd("GND1"),
      gnd("GND2"),
      gnd("GND3"),
      pin("RESET", ["reset"], 5),
      pin("AREF", ["vref"], 5),
      // A4 and A5 double as the I²C pair — the ambiguity that makes „is this an
      // analogue input or the bus?" a question about the wiring, not the pin.
      ...analog(6, 5, { 4: ["i2c-sda"], 5: ["i2c-scl"] }),
      ...digital(0, 13, {
        volts: 5,
        pwm: [3, 5, 6, 9, 10, 11],
        interrupt: [2, 3],
        also: {
          0: ["uart-rx"],
          1: ["uart-tx"],
          10: ["spi-cs"],
          11: ["spi-mosi"],
          12: ["spi-miso"],
          13: ["spi-sck"],
        },
      }),
    ],
  },
  {
    id: "arduino-nano",
    kind: "board",
    name: "Arduino Nano",
    summary: "UNO u formatu za protobord — isti ATmega328P, dva analogna ulaza više.",
    supply: { min: 7, max: 12 },
    current: { typical: 19, peak: 200 },
    logicVolts: 5,
    buses: [
      { kind: "i2c", addresses: [] },
      { kind: "spi" },
      { kind: "uart", baud: 9600 },
    ],
    pins: [
      pin("VIN", ["power-in"], undefined, "VIN"),
      powerOut("5V", 5),
      powerOut("3V3", 3.3, "3V3"),
      gnd("GND1"),
      gnd("GND2"),
      pin("RESET", ["reset"], 5),
      pin("AREF", ["vref"], 5),
      // A6 and A7 are analogue-only: they reach the ADC and not the digital port.
      ...analog(8, 5, { 4: ["i2c-sda"], 5: ["i2c-scl"] }),
      ...digital(0, 13, {
        volts: 5,
        pwm: [3, 5, 6, 9, 10, 11],
        interrupt: [2, 3],
        also: {
          0: ["uart-rx"],
          1: ["uart-tx"],
          10: ["spi-cs"],
          11: ["spi-mosi"],
          12: ["spi-miso"],
          13: ["spi-sck"],
        },
      }),
    ],
  },
  {
    id: "arduino-mega-2560",
    kind: "board",
    name: "Arduino Mega 2560 R3",
    summary: "54 digitalna i 16 analognih pinova, četiri hardverska serijska porta.",
    supply: { min: 7, max: 12 },
    current: { typical: 60, peak: 800 },
    logicVolts: 5,
    buses: [
      { kind: "i2c", addresses: [] },
      { kind: "spi" },
      { kind: "uart", baud: 9600 },
    ],
    pins: [
      pin("VIN", ["power-in"], undefined, "VIN"),
      powerOut("5V", 5),
      powerOut("3V3", 3.3, "3.3V"),
      gnd("GND1"),
      gnd("GND2"),
      gnd("GND3"),
      pin("RESET", ["reset"], 5),
      pin("AREF", ["vref"], 5),
      ...analog(16, 5),
      ...digital(0, 53, {
        volts: 5,
        pwm: [...through(2, 13), ...through(44, 46)],
        interrupt: [2, 3, 18, 19, 20, 21],
        also: {
          0: ["uart-rx"],
          1: ["uart-tx"],
          14: ["uart-tx"],
          15: ["uart-rx"],
          16: ["uart-tx"],
          17: ["uart-rx"],
          18: ["uart-tx"],
          19: ["uart-rx"],
          20: ["i2c-sda"],
          21: ["i2c-scl"],
          50: ["spi-miso"],
          51: ["spi-mosi"],
          52: ["spi-sck"],
          53: ["spi-cs"],
        },
      }),
    ],
  },
  {
    id: "arduino-leonardo",
    kind: "board",
    name: "Arduino Leonardo",
    summary: "ATmega32u4 — USB je na samom čipu, pa se ploča javlja kao tastatura ili miš.",
    supply: { min: 7, max: 12 },
    current: { typical: 40, peak: 200 },
    logicVolts: 5,
    buses: [
      { kind: "i2c", addresses: [] },
      { kind: "spi" },
      { kind: "uart", baud: 9600 },
    ],
    pins: [
      pin("VIN", ["power-in"], undefined, "VIN"),
      powerOut("5V", 5),
      powerOut("3V3", 3.3, "3.3V"),
      gnd("GND1"),
      gnd("GND2"),
      pin("RESET", ["reset"], 5),
      pin("AREF", ["vref"], 5),
      ...analog(6, 5),
      // SPI is on the ICSP header and NOWHERE ELSE — the Leonardo does not put
      // MISO/MOSI/SCK on D10–D13 the way an UNO does, so a shield that reaches
      // for them finds nothing. Caught by the catalogue gate: the entry declared
      // an SPI bus and had no pin carrying it, which is the `bus-pin` rule doing
      // exactly the job it was written for.
      pin("ICSP-MISO", ["spi-miso"], 5, "MISO"),
      pin("ICSP-MOSI", ["spi-mosi"], 5, "MOSI"),
      pin("ICSP-SCK", ["spi-sck"], 5, "SCK"),
      // The Leonardo moves I²C to D2/D3 and keeps A4/A5 analogue-only, which is
      // the single most common reason an UNO sketch does not run on one.
      ...digital(0, 13, {
        volts: 5,
        pwm: [3, 5, 6, 9, 10, 11, 13],
        interrupt: [0, 1, 2, 3, 7],
        also: {
          0: ["uart-rx"],
          1: ["uart-tx"],
          2: ["i2c-sda"],
          3: ["i2c-scl"],
        },
      }),
    ],
  },
  {
    id: "arduino-pro-mini",
    kind: "board",
    name: "Arduino Pro Mini 5V",
    summary: "Nano bez USB-a — programira se preko FTDI adaptera, troši najmanje od svih.",
    supply: { min: 5, max: 12 },
    current: { typical: 4, peak: 150 },
    logicVolts: 5,
    buses: [
      { kind: "i2c", addresses: [] },
      { kind: "spi" },
      { kind: "uart", baud: 9600 },
    ],
    pins: [
      pin("RAW", ["power-in"], undefined, "RAW"),
      powerOut("VCC", 5, "VCC"),
      gnd("GND1"),
      gnd("GND2"),
      pin("RESET", ["reset"], 5),
      ...analog(8, 5, { 4: ["i2c-sda"], 5: ["i2c-scl"] }),
      ...digital(0, 13, {
        volts: 5,
        pwm: [3, 5, 6, 9, 10, 11],
        interrupt: [2, 3],
        also: {
          0: ["uart-rx"],
          1: ["uart-tx"],
          10: ["spi-cs"],
          11: ["spi-mosi"],
          12: ["spi-miso"],
          13: ["spi-sck"],
        },
      }),
    ],
  },
  {
    id: "esp32-devkit-v1",
    kind: "board",
    name: "ESP32 DevKit V1",
    summary: "Wi-Fi i Bluetooth na ploči, 3.3 V logika — ne trpi 5 V na pinovima.",
    supply: { min: 5, max: 12 },
    current: { typical: 80, peak: 500 },
    logicVolts: 3.3,
    buses: [
      { kind: "i2c", addresses: [] },
      { kind: "spi" },
      { kind: "uart", baud: 115200 },
    ],
    pins: [
      pin("VIN", ["power-in"], undefined, "VIN"),
      powerOut("3V3", 3.3, "3V3"),
      gnd("GND1"),
      gnd("GND2"),
      gnd("GND3"),
      pin("EN", ["reset"], 3.3, "EN"),
      // Every GPIO can do PWM on an ESP32 — the LEDC peripheral is routed by the
      // matrix rather than fixed to numbered pins, so the PWM list is all of them
      // and the interesting restriction is elsewhere: 34–39 are input-only.
      ...digital(0, 33, {
        volts: 3.3,
        prefix: "GPIO",
        label: (number) => `G${number}`,
        pwm: through(0, 33),
        interrupt: through(0, 33),
        also: {
          1: ["uart-tx"],
          3: ["uart-rx"],
          5: ["spi-cs"],
          18: ["spi-sck"],
          19: ["spi-miso"],
          21: ["i2c-sda"],
          22: ["i2c-scl"],
          23: ["spi-mosi"],
        },
      }),
      // Input-only, and analogue: no `digital-out`, which is the whole point of
      // listing them apart from the run above.
      pin("GPIO34", ["digital-in", "analog-in"], 3.3, "G34"),
      pin("GPIO35", ["digital-in", "analog-in"], 3.3, "G35"),
      pin("GPIO36", ["digital-in", "analog-in"], 3.3, "G36"),
      pin("GPIO39", ["digital-in", "analog-in"], 3.3, "G39"),
    ],
  },
  {
    id: "esp8266-nodemcu",
    kind: "board",
    name: "NodeMCU ESP8266 V3",
    summary: "Jeftin Wi-Fi modul, 3.3 V logika i samo jedan analogni ulaz.",
    supply: { min: 5, max: 10 },
    current: { typical: 70, peak: 400 },
    logicVolts: 3.3,
    buses: [
      { kind: "i2c", addresses: [] },
      { kind: "spi" },
      { kind: "uart", baud: 115200 },
    ],
    pins: [
      pin("VIN", ["power-in"], undefined, "VIN"),
      powerOut("3V3", 3.3, "3V3"),
      gnd("GND1"),
      gnd("GND2"),
      pin("RST", ["reset"], 3.3, "RST"),
      // A0 reads 0–3.3 V on the NodeMCU board thanks to its divider; the bare
      // ESP8266 pin is 0–1 V, which is the trap this entry exists to state.
      pin("A0", ["analog-in"], 3.3, "A0"),
      ...digital(0, 16, {
        volts: 3.3,
        prefix: "GPIO",
        label: (number) => `D${number}`,
        pwm: through(0, 16),
        interrupt: through(0, 16),
        also: {
          1: ["uart-tx"],
          3: ["uart-rx"],
          4: ["i2c-sda"],
          5: ["i2c-scl"],
          12: ["spi-miso"],
          13: ["spi-mosi"],
          14: ["spi-sck"],
          15: ["spi-cs"],
        },
      }),
    ],
  },
  {
    id: "raspberry-pi-pico",
    kind: "board",
    name: "Raspberry Pi Pico",
    summary: "RP2040, 3.3 V logika, tri analogna ulaza i dva I²C kontrolera.",
    supply: { min: 1.8, max: 5.5 },
    current: { typical: 25, peak: 300 },
    logicVolts: 3.3,
    buses: [
      { kind: "i2c", addresses: [] },
      { kind: "spi" },
      { kind: "uart", baud: 115200 },
    ],
    pins: [
      pin("VSYS", ["power-in"], undefined, "VSYS"),
      pin("VBUS", ["power-in"], undefined, "VBUS"),
      powerOut("3V3", 3.3, "3V3"),
      gnd("GND1"),
      gnd("GND2"),
      gnd("GND3"),
      pin("RUN", ["reset"], 3.3, "RUN"),
      ...digital(0, 28, {
        volts: 3.3,
        prefix: "GP",
        label: (number) => `GP${number}`,
        pwm: through(0, 28),
        interrupt: through(0, 28),
        also: {
          0: ["uart-tx"],
          1: ["uart-rx"],
          2: ["spi-sck"],
          3: ["spi-mosi"],
          4: ["spi-miso"],
          5: ["spi-cs"],
          // GP26–28 are the ADC channels, and they stay digital as well.
          26: ["analog-in"],
          27: ["analog-in"],
          28: ["analog-in"],
          8: ["i2c-sda"],
          9: ["i2c-scl"],
        },
      }),
    ],
  },
  {
    id: "raspberry-pi-4b",
    kind: "board",
    name: "Raspberry Pi 4 Model B",
    summary: "Računar sa Linuxom i 40-pinskim zaglavljem — ovde je ROS 2 kod kod kuće.",
    supply: { min: 5, max: 5.1 },
    current: { typical: 600, peak: 3000 },
    logicVolts: 3.3,
    buses: [
      { kind: "i2c", addresses: [] },
      { kind: "spi" },
      { kind: "uart", baud: 115200 },
    ],
    pins: [
      pin("5V1", ["power-in"], 5, "5V"),
      powerOut("5V2", 5, "5V"),
      powerOut("3V3", 3.3, "3V3"),
      gnd("GND1"),
      gnd("GND2"),
      gnd("GND3"),
      gnd("GND4"),
      // No `analog` bus and no ADC: the Pi has none, and a sensor that needs one
      // must go through an external converter. Stating it here is what lets the
      // rules engine say so instead of the user finding out on the bench.
      ...digital(2, 27, {
        volts: 3.3,
        prefix: "GPIO",
        label: (number) => `GPIO${number}`,
        pwm: [12, 13, 18, 19],
        interrupt: through(2, 27),
        also: {
          2: ["i2c-sda"],
          3: ["i2c-scl"],
          8: ["spi-cs"],
          9: ["spi-miso"],
          10: ["spi-mosi"],
          11: ["spi-sck"],
          14: ["uart-tx"],
          15: ["uart-rx"],
        },
      }),
    ],
  },
  {
    id: "raspberry-pi-5",
    kind: "board",
    name: "Raspberry Pi 5",
    summary: "Isto 40-pinsko zaglavlje kao Pi 4, ali GPIO ide preko RP1 čipa.",
    supply: { min: 5, max: 5.1 },
    current: { typical: 800, peak: 5000 },
    logicVolts: 3.3,
    buses: [
      { kind: "i2c", addresses: [] },
      { kind: "spi" },
      { kind: "uart", baud: 115200 },
    ],
    pins: [
      pin("5V1", ["power-in"], 5, "5V"),
      powerOut("5V2", 5, "5V"),
      powerOut("3V3", 3.3, "3V3"),
      gnd("GND1"),
      gnd("GND2"),
      gnd("GND3"),
      gnd("GND4"),
      ...digital(2, 27, {
        volts: 3.3,
        prefix: "GPIO",
        label: (number) => `GPIO${number}`,
        pwm: [12, 13, 18, 19],
        interrupt: through(2, 27),
        also: {
          2: ["i2c-sda"],
          3: ["i2c-scl"],
          8: ["spi-cs"],
          9: ["spi-miso"],
          10: ["spi-mosi"],
          11: ["spi-sck"],
          14: ["uart-tx"],
          15: ["uart-rx"],
        },
      }),
    ],
  },
];
