/**
 * What a circuit shows.
 *
 * The parallel-wired character LCD is the reason this group is not simply „I²C
 * modules": an HD44780 in 4-bit mode occupies six board pins and speaks no
 * protocol at all, which on an UNO is most of the digital header gone before the
 * first sensor is placed. That is precisely the trade the I²C backpack exists to
 * undo, and both are catalogued so the canvas can show the difference rather
 * than assume it.
 *
 * Addressable LED strips live here rather than under actuators: the user is
 * writing pixels, and the practical question — 60 mA per LED at full white, so a
 * strip of thirty is nearly two amps — is a display question about brightness,
 * not a motor question.
 */

import type { ComponentDef } from "../component.js";
import { gnd, pin, powerIn } from "./pins.js";

const i2cPins: ComponentDef["pins"] = [
  powerIn(),
  gnd(),
  pin("SDA", ["i2c-sda"]),
  pin("SCL", ["i2c-scl"]),
];

/** The four data lines plus RS/E that every HD44780-family panel wants. */
const hd44780 = (): ComponentDef["pins"] => [
  powerIn(),
  gnd(),
  pin("VO", ["analog-in"]),
  pin("RS", ["digital-in"]),
  pin("RW", ["digital-in"]),
  pin("E", ["digital-in"]),
  pin("D4", ["digital-in"]),
  pin("D5", ["digital-in"]),
  pin("D6", ["digital-in"]),
  pin("D7", ["digital-in"]),
  pin("LED+", ["power-in"]),
  pin("LED-", ["gnd"]),
];

export const DISPLAYS: readonly ComponentDef[] = [
  // ── Character panels ──────────────────────────────────────────────────────
  {
    id: "lcd-1602",
    kind: "display",
    name: "LCD 16×2 (HD44780)",
    nameEn: "LCD 16×2 (HD44780)",
    summary: "Dva reda po šesnaest znakova; u 4-bitnom režimu zauzima šest pinova ploče.",
    summaryEn: "Two rows of sixteen characters; in 4-bit mode it takes six board pins.",
    supply: { min: 4.7, max: 5.3 },
    current: { typical: 2, peak: 25 },
    buses: [],
    pins: hd44780(),
    library: "LiquidCrystal",
  },
  {
    id: "lcd-2004",
    kind: "display",
    name: "LCD 20×4 (HD44780)",
    nameEn: "LCD 20×4 (HD44780)",
    summary: "Isti kontroler i isto ožičenje kao 16×2, samo veći ekran.",
    summaryEn: "The same controller and the same wiring as the 16×2, just a bigger screen.",
    supply: { min: 4.7, max: 5.3 },
    current: { typical: 2.5, peak: 30 },
    buses: [],
    pins: hd44780(),
    library: "LiquidCrystal",
  },
  {
    id: "lcd-1602-i2c",
    kind: "display",
    name: "LCD 16×2 sa I²C pločicom",
    nameEn: "LCD 16×2 with an I²C backpack",
    summary: "PCF8574 svede isti ekran na dve žice — otud i skoro uvek bolji izbor.",
    summaryEn: "A PCF8574 reduces the same screen to two wires — which is why it is almost always the better choice.",
    supply: { min: 4.7, max: 5.3 },
    current: { typical: 3, peak: 30 },
    buses: [{ kind: "i2c", addresses: [0x27, 0x3f] }],
    pins: i2cPins,
    library: "LiquidCrystal I2C",
  },

  // ── Graphic panels ────────────────────────────────────────────────────────
  {
    id: "oled-ssd1306",
    kind: "display",
    name: 'OLED 0.96" SSD1306',
    nameEn: 'OLED 0.96" SSD1306',
    summary: "128×64 tačke, bez pozadinskog osvetljenja — crno je stvarno ugašeno.",
    summaryEn: "128×64 dots with no backlight — black is genuinely off.",
    supply: { min: 3.3, max: 5 },
    current: { typical: 8, peak: 25 },
    buses: [{ kind: "i2c", addresses: [0x3c, 0x3d] }],
    pins: i2cPins,
    library: "Adafruit SSD1306",
  },
  {
    id: "oled-sh1106",
    kind: "display",
    name: 'OLED 1.3" SH1106',
    nameEn: 'OLED 1.3" SH1106',
    summary: "Veći brat SSD1306; ista veza, ali traži drugu biblioteku i pomak od dva piksela.",
    summaryEn: "The SSD1306's bigger brother; the same wiring, but a different library and a two-pixel offset.",
    supply: { min: 3.3, max: 5 },
    current: { typical: 10, peak: 30 },
    buses: [{ kind: "i2c", addresses: [0x3c, 0x3d] }],
    pins: i2cPins,
    library: "U8g2",
  },
  {
    id: "tft-st7735",
    kind: "display",
    name: 'TFT 1.8" ST7735',
    nameEn: 'TFT 1.8" ST7735',
    summary: "160×128 u boji preko SPI-ja; brz dovoljno za merače i grafikone.",
    summaryEn: "160×128 in colour over SPI; fast enough for gauges and charts.",
    supply: { min: 3.3, max: 5 },
    current: { typical: 40, peak: 80 },
    buses: [{ kind: "spi" }],
    pins: [
      powerIn(),
      gnd(),
      pin("SCK", ["spi-sck"]),
      pin("SDA", ["spi-mosi"]),
      pin("CS", ["spi-cs"]),
      pin("DC", ["digital-in"]),
      pin("RES", ["digital-in", "reset"]),
      pin("BLK", ["digital-in"]),
    ],
    library: "Adafruit ST7735 and ST7789 Library",
  },
  {
    id: "tft-ili9341",
    kind: "display",
    name: 'TFT 2.8" ILI9341',
    nameEn: 'TFT 2.8" ILI9341',
    summary: "320×240 sa opcionim ekranom na dodir; na UNO-u je spor, na ESP32 udoban.",
    summaryEn: "320×240 with an optional touchscreen; slow on a UNO, comfortable on an ESP32.",
    supply: { min: 3.3, max: 5 },
    current: { typical: 90, peak: 150 },
    buses: [{ kind: "spi" }],
    pins: [
      powerIn(),
      gnd(),
      pin("SCK", ["spi-sck"]),
      pin("MOSI", ["spi-mosi"]),
      pin("MISO", ["spi-miso"]),
      pin("CS", ["spi-cs"]),
      pin("DC", ["digital-in"]),
      pin("RESET", ["digital-in", "reset"]),
      pin("LED", ["power-in"]),
    ],
    library: "TFT_eSPI",
  },
  {
    id: "epaper-2in9",
    kind: "display",
    name: 'E-papir 2.9"',
    nameEn: '2.9" e-paper',
    summary: "Slika ostaje i bez struje; osvežavanje traje sekundu — za merače, ne za animaciju.",
    summaryEn: "The image stays with the power off; a refresh takes a second — for gauges, not animation.",
    supply: { min: 2.3, max: 3.6 },
    current: { typical: 1, peak: 15 },
    buses: [{ kind: "spi" }],
    pins: [
      powerIn(),
      gnd(),
      pin("CLK", ["spi-sck"]),
      pin("DIN", ["spi-mosi"]),
      pin("CS", ["spi-cs"]),
      pin("DC", ["digital-in"]),
      pin("RST", ["digital-in", "reset"]),
      pin("BUSY", ["digital-out"]),
    ],
    library: "GxEPD2",
  },

  // ── Segments and matrices ─────────────────────────────────────────────────
  {
    id: "tm1637-4digit",
    kind: "display",
    name: "TM1637 (četiri cifre)",
    nameEn: "TM1637 (four digits)",
    summary: "Sedmosegmentni displej sa dve žice — sat, brojač, temperatura.",
    summaryEn: "A seven-segment display on two wires — clock, counter, temperature.",
    supply: { min: 3.3, max: 5.5 },
    current: { typical: 20, peak: 80 },
    buses: [],
    // CLK and DIO look like I²C and are not: no addressing, no ACK by address.
    // Declaring an I²C bus here would put it in an address-collision check it
    // does not take part in.
    pins: [powerIn(), gnd(), pin("CLK", ["digital-in"]), pin("DIO", ["digital-in", "digital-out"])],
    library: "TM1637",
  },
  {
    id: "max7219-matrix",
    kind: "display",
    name: "MAX7219 LED matrica 8×8",
    nameEn: "MAX7219 8×8 LED matrix",
    summary: "Kaskadira se u traku od više modula — natpisi koji klize.",
    summaryEn: "It cascades into a strip of modules — scrolling text.",
    supply: { min: 4, max: 5.5 },
    current: { typical: 60, peak: 330 },
    buses: [{ kind: "spi" }],
    pins: [
      powerIn(),
      gnd(),
      pin("DIN", ["spi-mosi"]),
      pin("CS", ["spi-cs"]),
      pin("CLK", ["spi-sck"]),
    ],
    library: "MD_MAX72XX",
  },

  // ── Addressable LEDs ──────────────────────────────────────────────────────
  {
    id: "ws2812b-strip",
    kind: "display",
    name: "WS2812B traka (NeoPixel)",
    nameEn: "WS2812B strip (NeoPixel)",
    summary: "Jedan pin za celu traku; na punoj beloj svaka dioda vuče 60 mA.",
    summaryEn: "One pin for the whole strip; at full white each diode draws 60 mA.",
    supply: { min: 3.5, max: 5.3 },
    current: { typical: 300, peak: 1800 },
    buses: [],
    pins: [powerIn(), gnd(), pin("DIN", ["digital-in"])],
    library: "Adafruit NeoPixel",
  },
  {
    id: "ws2812b-ring-16",
    kind: "display",
    name: "WS2812B prsten (16 dioda)",
    nameEn: "WS2812B ring (16 LEDs)",
    summary: "Isti protokol u krugu — pokazivač napretka, sat, efekat.",
    summaryEn: "The same protocol in a circle — a progress ring, a clock, an effect.",
    supply: { min: 3.5, max: 5.3 },
    current: { typical: 160, peak: 960 },
    buses: [],
    pins: [powerIn(), gnd(), pin("DIN", ["digital-in"])],
    library: "Adafruit NeoPixel",
  },
];
