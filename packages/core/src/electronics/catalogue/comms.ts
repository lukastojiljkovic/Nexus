/**
 * Radios, readers and everything that carries data off the board.
 *
 * Two facts about this group cause most of the wiring faults it sees, and both
 * are in the entries rather than in a note somewhere.
 *
 * The first is voltage. An ESP-01, an NRF24L01 and an RC522 are 3.3 V parts with
 * 5 V-tolerant-looking headers, and a beginner's first ESP-01 usually dies on an
 * UNO's 5 V rail. `supply.max` says 3.6 and the rules engine refuses the wire.
 *
 * The second is current. The same ESP-01 idles at 70 mA and spikes to 300 during
 * a transmit burst, and a SIM800L wants two amps for the two milliseconds it
 * talks to a tower. Both are far beyond what an UNO's on-board regulator gives,
 * which is why they work „sometimes" — the module browns out mid-packet and the
 * sketch looks buggy.
 */

import type { ComponentDef } from "../component.js";
import { gnd, pin, powerIn } from "./pins.js";

/** VCC + GND + TX/RX, which is the whole wiring of most modules here. */
const uartPins = (): ComponentDef["pins"] => [
  powerIn(),
  gnd(),
  pin("TX", ["uart-tx"]),
  pin("RX", ["uart-rx"]),
];

export const COMMS: readonly ComponentDef[] = [
  // ── Bluetooth ─────────────────────────────────────────────────────────────
  {
    id: "hc-05",
    kind: "comms",
    name: "HC-05",
    summary: "Bluetooth serijski most koji može biti i master; RX pin traži delitelj sa 5 V.",
    supply: { min: 3.6, max: 6 },
    current: { typical: 8, peak: 40 },
    buses: [{ kind: "uart", baud: 9600 }],
    pins: [...uartPins(), pin("EN", ["digital-in"]), pin("STATE", ["digital-out"])],
  },
  {
    id: "hc-06",
    kind: "comms",
    name: "HC-06",
    summary: "Isti modul, samo slave — telefon se povezuje na njega, nikad obrnuto.",
    supply: { min: 3.6, max: 6 },
    current: { typical: 8, peak: 40 },
    buses: [{ kind: "uart", baud: 9600 }],
    pins: uartPins(),
  },
  {
    id: "hm-10",
    kind: "comms",
    name: "HM-10 (BLE)",
    summary: "Bluetooth Low Energy — jedini iz ove grupe koji radi sa iPhone-om.",
    supply: { min: 2, max: 3.6 },
    current: { typical: 9, peak: 50 },
    buses: [{ kind: "uart", baud: 9600 }],
    pins: uartPins(),
  },

  // ── Wi-Fi and mobile ──────────────────────────────────────────────────────
  {
    id: "esp-01",
    kind: "comms",
    name: "ESP-01 (ESP8266)",
    summary: "Wi-Fi u osam pinova. Strogo 3.3 V, i traži izvor koji daje 300 mA u naletu.",
    supply: { min: 3, max: 3.6 },
    current: { typical: 70, peak: 320 },
    buses: [{ kind: "uart", baud: 115200 }],
    pins: [
      ...uartPins(),
      pin("CH_PD", ["digital-in"]),
      pin("RST", ["digital-in", "reset"]),
      pin("GPIO0", ["digital-in", "digital-out"]),
      pin("GPIO2", ["digital-in", "digital-out"]),
    ],
  },
  {
    id: "sim800l",
    kind: "comms",
    name: "SIM800L (GSM/GPRS)",
    summary: "SMS i poziv preko 2G; u naletu traži 2 A, pa mu treba sopstveno napajanje.",
    supply: { min: 3.4, max: 4.4 },
    current: { typical: 100, peak: 2000 },
    buses: [{ kind: "uart", baud: 9600 }],
    pins: [...uartPins(), pin("RST", ["digital-in", "reset"])],
  },
  {
    id: "w5500",
    kind: "comms",
    name: "W5500 (Ethernet)",
    summary: "Žičana mreža preko SPI-ja — bez Wi-Fi-ja i bez lozinke u kodu.",
    supply: { min: 3, max: 3.6 },
    current: { typical: 132, peak: 183 },
    buses: [{ kind: "spi" }],
    pins: [
      powerIn(),
      gnd(),
      pin("SCLK", ["spi-sck"]),
      pin("MOSI", ["spi-mosi"]),
      pin("MISO", ["spi-miso"]),
      pin("SCS", ["spi-cs"]),
      pin("RST", ["digital-in", "reset"]),
      pin("INT", ["digital-out", "interrupt"]),
    ],
    library: "Ethernet",
  },

  // ── Point-to-point radio ──────────────────────────────────────────────────
  {
    id: "nrf24l01",
    kind: "comms",
    name: "NRF24L01+",
    summary: "Jeftina veza dve ploče na 2.4 GHz; skoro uvek traži kondenzator na napajanju.",
    supply: { min: 1.9, max: 3.6 },
    current: { typical: 12, peak: 115 },
    buses: [{ kind: "spi" }],
    pins: [
      powerIn(),
      gnd(),
      pin("CE", ["digital-in"]),
      pin("CSN", ["spi-cs"]),
      pin("SCK", ["spi-sck"]),
      pin("MOSI", ["spi-mosi"]),
      pin("MISO", ["spi-miso"]),
      pin("IRQ", ["digital-out", "interrupt"]),
    ],
    library: "RF24",
  },
  {
    id: "lora-sx1278",
    kind: "comms",
    name: "LoRa SX1278 (433 MHz)",
    summary: "Kilometri dometa uz malu potrošnju — za senzore u polju, ne za video.",
    supply: { min: 1.8, max: 3.7 },
    current: { typical: 12, peak: 120 },
    buses: [{ kind: "spi" }],
    pins: [
      powerIn(),
      gnd(),
      pin("SCK", ["spi-sck"]),
      pin("MOSI", ["spi-mosi"]),
      pin("MISO", ["spi-miso"]),
      pin("NSS", ["spi-cs"]),
      pin("RST", ["digital-in", "reset"]),
      pin("DIO0", ["digital-out", "interrupt"]),
    ],
    library: "LoRa",
  },
  {
    id: "hc-12",
    kind: "comms",
    name: "HC-12 (433 MHz serijski)",
    summary: "Bežični produžetak serijske veze — radi bez ijedne biblioteke.",
    supply: { min: 3.2, max: 5.5 },
    current: { typical: 16, peak: 100 },
    buses: [{ kind: "uart", baud: 9600 }],
    pins: [...uartPins(), pin("SET", ["digital-in"])],
  },
  {
    id: "rf-433-pair",
    kind: "comms",
    name: "433 MHz predajnik + prijemnik",
    summary: "Najjeftiniji par za jednosmernu vezu; bez provere, pa i bez garancije da je stiglo.",
    supply: { min: 3, max: 12 },
    current: { typical: 4, peak: 40 },
    buses: [],
    pins: [powerIn(), gnd(), pin("DATA", ["digital-in", "digital-out"])],
    library: "RadioHead",
  },
  {
    id: "ir-led-transmitter",
    kind: "comms",
    name: "IR predajnik",
    summary: "Šalje kodove daljinskog — para za TSOP prijemnik iz grupe senzora.",
    supply: { min: 3.3, max: 5 },
    current: { typical: 20, peak: 50 },
    buses: [],
    pins: [powerIn(), gnd(), pin("DAT", ["digital-in", "pwm"])],
    library: "IRremote",
  },

  // ── Identification and position ───────────────────────────────────────────
  {
    id: "rc522",
    kind: "comms",
    name: "RC522 (RFID 13.56 MHz)",
    summary: "Čita kartice i privezke; strogo 3.3 V iako ploča često daje 5 V.",
    supply: { min: 2.5, max: 3.6 },
    current: { typical: 26, peak: 30 },
    buses: [{ kind: "spi" }],
    pins: [
      powerIn(),
      gnd(),
      pin("SDA", ["spi-cs"]),
      pin("SCK", ["spi-sck"]),
      pin("MOSI", ["spi-mosi"]),
      pin("MISO", ["spi-miso"]),
      pin("RST", ["digital-in", "reset"]),
      pin("IRQ", ["digital-out", "interrupt"]),
    ],
    library: "MFRC522",
  },
  {
    id: "pn532",
    kind: "comms",
    name: "PN532 (NFC)",
    summary: "Čita i telefone, ne samo kartice; bira se I²C ili SPI prekidačem na modulu.",
    supply: { min: 2.7, max: 5.5 },
    current: { typical: 100, peak: 150 },
    buses: [{ kind: "i2c", addresses: [0x24] }],
    pins: [powerIn(), gnd(), pin("SDA", ["i2c-sda"]), pin("SCL", ["i2c-scl"]), pin("IRQ", ["digital-out", "interrupt"])],
    library: "Adafruit PN532",
  },
  {
    id: "neo-6m",
    kind: "comms",
    name: "NEO-6M (GPS)",
    summary: "Šalje NMEA rečenice na 9600 bauda; prvi fiks pod vedrim nebom traje i minut.",
    supply: { min: 3, max: 5 },
    current: { typical: 45, peak: 67 },
    buses: [{ kind: "uart", baud: 9600 }],
    pins: [...uartPins(), pin("PPS", ["digital-out", "interrupt"])],
    library: "TinyGPSPlus",
  },
  {
    id: "r307-fingerprint",
    kind: "comms",
    name: "R307 (čitač otiska prsta)",
    summary: "Poređenje radi sam i vraća samo ID — otisak ne izlazi iz modula.",
    supply: { min: 3.6, max: 6 },
    current: { typical: 100, peak: 150 },
    buses: [{ kind: "uart", baud: 57600 }],
    pins: [...uartPins(), pin("TOUCH", ["digital-out"])],
    library: "Adafruit Fingerprint Sensor Library",
  },

  // ── Storage ───────────────────────────────────────────────────────────────
  {
    id: "sd-card-module",
    kind: "comms",
    name: "Modul za microSD karticu",
    summary: "Beleženje merenja u fajl — jedini način da podaci prežive nestanak struje.",
    supply: { min: 3.3, max: 5 },
    current: { typical: 20, peak: 100 },
    buses: [{ kind: "spi" }],
    pins: [
      powerIn(),
      gnd(),
      pin("SCK", ["spi-sck"]),
      pin("MOSI", ["spi-mosi"]),
      pin("MISO", ["spi-miso"]),
      pin("CS", ["spi-cs"]),
    ],
    library: "SD",
  },
];
