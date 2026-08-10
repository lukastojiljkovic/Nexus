import { describe, expect, it } from "vitest";

import {
  apcaLc,
  colourName,
  compositeOver,
  contrastRatio,
  contrastReport,
  convertColour,
  CSS_EASINGS,
  COLOUR_FORMATS,
  easingAt,
  formatColour,
  fromHsl,
  fromOklch,
  gradientCss,
  harmony,
  isInGamut,
  isLegalEasing,
  linearRgbToOklab,
  linearRgbToXyz,
  linearToSrgb,
  mixColours,
  NAMED_COLOUR_COUNT,
  namedColourNames,
  parseColour,
  relativeLuminance,
  sampleEasing,
  sampleGradient,
  srgb,
  srgbToLinear,
  tintsAndShades,
  toHex,
  toHsl,
  toLab,
  toOklab,
  toOklch,
  xyzToLab,
  type ColourFormat,
  type CubicBezierEasing,
  type Srgb,
} from "./colour";

/** Parses or fails the test — keeps every case free of non-null assertions. */
function parsed(text: string): Srgb {
  const colour = parseColour(text);
  if (colour === null) throw new Error(`expected "${text}" to parse`);
  return colour;
}

/** Indexes or fails the test, for the same reason. */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at ${index}`);
  return item;
}

function hexOf(text: string): string {
  return toHex(parsed(text));
}

describe("sRGB transfer function", () => {
  it("pins the two ends", () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBe(1);
    expect(linearToSrgb(0)).toBe(0);
    // Not exactly 1: `1.055 * 1 - 0.055` is one unit in the last place short,
    // and the module comment on `linearToSrgb` says why that is left alone.
    expect(linearToSrgb(1)).toBeCloseTo(1, 15);
  });

  it("matches the hand-computed value at the midpoint", () => {
    // ((0,5 + 0,055) / 1,055) ^ 2,4 = 0,4907536^2,4 = 0,21404114
    expect(srgbToLinear(0.5)).toBeCloseTo(0.21404114, 8);
  });

  it("joins its two branches at the 0,04045 knee", () => {
    const knee = 0.04045;
    const linearBranch = knee / 12.92;
    const powerBranch = ((knee + 0.055) / 1.055) ** 2.4;
    expect(Math.abs(linearBranch - powerBranch)).toBeLessThan(1e-6);
  });

  it("is sign-extended, so a wide-gamut negative survives the trip", () => {
    expect(srgbToLinear(-0.5)).toBeCloseTo(-srgbToLinear(0.5), 15);
    expect(linearToSrgb(srgbToLinear(-0.3))).toBeCloseTo(-0.3, 12);
  });

  it("round-trips, including across the knee itself", () => {
    // The standard's two published knees are not each other's inverse
    // (0,0031308 × 12,92 = 0,040449936, not 0,04045), so quoting both leaves the
    // two functions on opposite branches right here and off by 3 × 10⁻⁸. The
    // linear knee is derived from the encoded one for exactly this case.
    for (const value of [0.001, 0.0031308, 0.04045, 0.0404499, 0.0404501, 0.25, 0.5, 0.9]) {
      expect(linearToSrgb(srgbToLinear(value))).toBeCloseTo(value, 12);
    }
  });
});

describe("linear sRGB to CIE XYZ", () => {
  it("puts pure red on CSS Color 4's D65 column", () => {
    // `conversions.js`'s `lin_sRGB_to_XYZ`, first column: 506752/1228815,
    // 87098/409605, 7918/409605. These are NOT Lindbloom's 0,4124564 /
    // 0,2126729 / 0,0193339 — his matrix is derived against a different D65
    // from the Bradford adaptation this file uses, and one pipeline gets one
    // authority.
    const [x, y, z] = linearRgbToXyz([1, 0, 0]);
    expect(x).toBeCloseTo(0.4123908, 7);
    expect(y).toBeCloseTo(0.212639, 7);
    expect(z).toBeCloseTo(0.0193308, 7);
  });

  it("sends white to a Y of 1", () => {
    const [, y] = linearRgbToXyz([1, 1, 1]);
    expect(y).toBeCloseTo(1, 6);
  });
});

describe("CIELAB", () => {
  it("gives sRGB red the published D65 Lab coordinates", () => {
    // CIE Lab (D65, 2°) of sRGB red: L* 53,24  a* 80,09  b* 67,20.
    const [l, a, b] = xyzToLab(linearRgbToXyz([1, 0, 0]));
    expect(l).toBeCloseTo(53.24, 1);
    expect(a).toBeCloseTo(80.09, 1);
    expect(b).toBeCloseTo(67.2, 1);
  });

  it("makes white exactly neutral on the CSS (D50) surface", () => {
    // The white point is read off the matrix, so this is exact rather than close.
    const white = toLab(srgb(1, 1, 1));
    expect(white.l).toBe(100);
    expect(white.a).toBe(0);
    expect(white.b).toBe(0);
  });

  it("gives sRGB red the D50 coordinates a browser prints for lab()", () => {
    // CSS lab() is D50-referred: lab(54.29 80.81 69.89) for #ff0000.
    const red = toLab(parsed("#ff0000"));
    expect(red.l).toBeCloseTo(54.29, 1);
    expect(red.a).toBeCloseTo(80.81, 1);
    expect(red.b).toBeCloseTo(69.89, 1);
  });

  it("prints the digits CSS Color 4's own conversions.js produces, to the third decimal", () => {
    // The specification's sample code, run over the three primaries. This is
    // the whole of defect 3: with Lindbloom's sRGB matrix feeding CSS's
    // Bradford adaptation, red came out lab(54,2942 80,8062 69,8910) and green
    // lab(87,8176 −79,2731 80,9869) — wrong in the third decimal, which is a
    // digit `formatColour` shows. Two D65 conventions, one pipeline.
    const oracle: readonly [string, number, number, number][] = [
      ["#ff0000", 54.2905, 80.8049, 69.891],
      ["#00ff00", 87.8185, -79.2711, 80.9946],
      ["#0000ff", 29.5683, 68.2874, -112.0297],
    ];
    for (const [hex, l, a, b] of oracle) {
      const lab = toLab(parsed(hex));
      expect(lab.l).toBeCloseTo(l, 3);
      expect(lab.a).toBeCloseTo(a, 3);
      expect(lab.b).toBeCloseTo(b, 3);
    }
  });
});

describe("Oklab", () => {
  it("sends white to L = 1 with no chroma", () => {
    // Ottosson's definition normalises D65 white to (1, 0, 0).
    const [l, a, b] = linearRgbToOklab([1, 1, 1]);
    expect(l).toBeCloseTo(1, 6);
    expect(a).toBeCloseTo(0, 6);
    expect(b).toBeCloseTo(0, 6);
  });

  it("matches the published Oklab of sRGB red", () => {
    // Hand-derived from Ottosson's matrices: l' = 0,74424  m' = 0,59619
    // s' = 0,44530 give L 0,6280  a 0,2249  b 0,1259.
    const red = toOklab(parsed("#ff0000"));
    expect(red.l).toBeCloseTo(0.628, 3);
    expect(red.a).toBeCloseTo(0.2249, 3);
    expect(red.b).toBeCloseTo(0.1258, 3);
  });

  it("matches the published Oklch of sRGB red", () => {
    // C = hypot(0,2249; 0,1258) = 0,2577   h = atan2(0,1258; 0,2249) = 29,23°
    const red = toOklch(parsed("#ff0000"));
    expect(red.c).toBeCloseTo(0.2577, 3);
    expect(red.h).toBeCloseTo(29.23, 1);
  });

  it("survives a cube root of a negative cone response", () => {
    // An out-of-gamut colour drives one LMS channel below zero; `** (1/3)`
    // would return NaN here and `Math.cbrt` does not.
    const wide = fromOklch({ l: 0.8, c: 0.35, h: 150, alpha: 1 });
    expect(Number.isFinite(wide.r)).toBe(true);
    expect(Number.isFinite(wide.g)).toBe(true);
    expect(Number.isFinite(wide.b)).toBe(true);
    expect(isInGamut(wide)).toBe(false);
  });
});

describe("named colours", () => {
  it("ships all 148", () => {
    expect(namedColourNames()).toHaveLength(NAMED_COLOUR_COUNT);
  });

  it("resolves the ones with well-known bytes", () => {
    expect(hexOf("red")).toBe("#ff0000");
    expect(hexOf("rebeccapurple")).toBe("#663399");
    expect(hexOf("cornflowerblue")).toBe("#6495ed");
    expect(hexOf("gainsboro")).toBe("#dcdcdc");
  });

  it("keeps the specification's duplicate spellings pointing at the same bytes", () => {
    expect(hexOf("aqua")).toBe(hexOf("cyan"));
    expect(hexOf("fuchsia")).toBe(hexOf("magenta"));
    expect(hexOf("gray")).toBe(hexOf("grey"));
    expect(hexOf("darkslategray")).toBe(hexOf("darkslategrey"));
  });

  it("names a colour back, choosing the alphabetically first of a shared pair", () => {
    expect(colourName(parsed("#00ffff"))).toBe("aqua");
    expect(colourName(parsed("#808080"))).toBe("gray");
    expect(colourName(parsed("#123456"))).toBeNull();
  });

  it("refuses to name a translucent colour, because no name carries alpha", () => {
    expect(colourName(parsed("#ff000080"))).toBeNull();
  });

  it("knows transparent, which is a keyword rather than one of the 148", () => {
    const transparent = parsed("transparent");
    expect(transparent.alpha).toBe(0);
    expect(namedColourNames()).not.toContain("transparent");
  });
});

describe("hex parsing", () => {
  it("expands the short forms by doubling each digit", () => {
    expect(hexOf("#f00")).toBe("#ff0000");
    expect(hexOf("#abc")).toBe("#aabbcc");
    expect(parsed("#f008").alpha).toBeCloseTo(0x88 / 255, 12);
  });

  it("is case-insensitive", () => {
    expect(hexOf("#AaBbCc")).toBe("#aabbcc");
  });

  it("keeps eight-digit alpha", () => {
    expect(hexOf("#3366cc80")).toBe("#3366cc80");
  });

  it("refuses lengths CSS does not define", () => {
    for (const text of ["#f", "#ff", "#fffff", "#fffffff", "#fffffffff", "#gg0000"]) {
      expect(parseColour(text)).toBeNull();
    }
  });
});

describe("rgb() parsing", () => {
  it("accepts both the comma form and the space form", () => {
    expect(hexOf("rgb(255, 0, 0)")).toBe("#ff0000");
    expect(hexOf("rgb(255 0 0)")).toBe("#ff0000");
    expect(hexOf("rgba(255, 0, 0, 0.5)")).toBe("#ff000080");
    expect(hexOf("rgb(255 0 0 / 50%)")).toBe("#ff000080");
  });

  it("accepts percentages, and CSS Color 4's mixing of the two", () => {
    expect(hexOf("rgb(100% 0% 0%)")).toBe("#ff0000");
    expect(hexOf("rgb(100% 0 0)")).toBe("#ff0000");
  });

  it("clamps where CSS clamps rather than refusing text a browser accepts", () => {
    expect(hexOf("rgb(300 -20 0)")).toBe("#ff0000");
    expect(parsed("rgb(0 0 0 / 5)").alpha).toBe(1);
  });

  it("refuses a mixture of the comma and space forms", () => {
    expect(parseColour("rgb(255, 0 0)")).toBeNull();
    expect(parseColour("rgb(255 0, 0)")).toBeNull();
  });

  it("refuses the wrong number of components", () => {
    for (const text of ["rgb(255 0)", "rgb(1,2)", "rgb(1,2,3,4,5)", "rgb(1 2 3 4)"]) {
      expect(parseColour(text)).toBeNull();
    }
  });
});

describe("hsl() and hwb() parsing", () => {
  it("puts the primaries on the wheel where they belong", () => {
    expect(hexOf("hsl(0 100% 50%)")).toBe("#ff0000");
    expect(hexOf("hsl(120 100% 50%)")).toBe("#00ff00");
    expect(hexOf("hsl(240 100% 50%)")).toBe("#0000ff");
  });

  it("reads every angle unit", () => {
    // 0,5turn = 200grad = π rad = 180°, and 180° at full chroma is cyan.
    expect(hexOf("hsl(0.5turn 100% 50%)")).toBe("#00ffff");
    expect(hexOf("hsl(200grad 100% 50%)")).toBe("#00ffff");
    expect(hexOf("hsl(3.14159265358979rad 100% 50%)")).toBe("#00ffff");
    expect(hexOf("hsl(180deg 100% 50%)")).toBe("#00ffff");
  });

  it("folds a hue past a full turn", () => {
    expect(hexOf("hsl(480 100% 50%)")).toBe(hexOf("hsl(120 100% 50%)"));
    expect(hexOf("hsl(-120 100% 50%)")).toBe(hexOf("hsl(240 100% 50%)"));
  });

  it("reads HWB, including the whiteness-plus-blackness overflow CSS defines", () => {
    expect(hexOf("hwb(0 0% 0%)")).toBe("#ff0000");
    // w + b >= 1 is the grey w / (w + b) = 0,5 -> 127,5 -> 128.
    expect(hexOf("hwb(0 50% 50%)")).toBe("#808080");
    expect(hexOf("hwb(0 60% 60%)")).toBe("#808080");
  });

  it("refuses the comma form for hwb(), which never had one", () => {
    expect(parseColour("hwb(0, 0%, 0%)")).toBeNull();
  });
});

describe("the Lab family parsing", () => {
  it("reads lab() and lch() as D50, matching a browser", () => {
    expect(hexOf("lab(54.29 80.81 69.89)")).toBe("#ff0000");
    expect(hexOf("lch(54.29 106.84 40.85)")).toBe("#ff0000");
  });

  it("reads oklab() and oklch()", () => {
    expect(hexOf("oklab(0.628 0.2249 0.1258)")).toBe("#ff0000");
    expect(hexOf("oklch(0.628 0.2577 29.23)")).toBe("#ff0000");
  });

  it("reads the percentage references CSS Color 4 fixes", () => {
    // 100% of oklab's a/b axis is 0,4; 100% of lightness is 1 for the ok- forms.
    expect(parsed("oklab(50% 0% 0%)").r).toBeCloseTo(parsed("oklab(0.5 0 0)").r, 12);
    expect(parsed("oklch(50% 25% 30)").g).toBeCloseTo(parsed("oklch(0.5 0.1 30)").g, 12);
    // 100% of lab's a/b axis is 125, of lch's chroma 150.
    expect(parsed("lab(50% 40% -20%)").b).toBeCloseTo(parsed("lab(50 50 -25)").b, 12);
    expect(parsed("lch(50% 50% 30)").r).toBeCloseTo(parsed("lch(50 75 30)").r, 12);
  });

  it("keeps an out-of-gamut colour out of gamut instead of clamping it away", () => {
    const wide = parsed("oklch(0.9 0.4 140)");
    expect(isInGamut(wide)).toBe(false);
    expect(Math.max(wide.r, wide.g, wide.b)).toBeGreaterThan(1);
  });

  it("refuses `none`, which this tool has no way to carry", () => {
    expect(parseColour("oklch(none 0.2 30)")).toBeNull();
    expect(parseColour("lab(50 none 20)")).toBeNull();
    expect(parseColour("rgb(255 0 0 / none)")).toBeNull();
  });
});

describe("parsing refusals", () => {
  it("refuses everything that is not a colour", () => {
    for (const text of [
      "",
      "   ",
      "notacolour",
      "currentcolor",
      "color(display-p3 1 0 0)",
      "rgb(255 0 0",
      "rgb 255 0 0",
      "rgb(rgb(1 2 3) 0 0)",
      "hsl(120 50 percent 50%)",
      "rgb(1,2,3)extra",
    ]) {
      expect(parseColour(text)).toBeNull();
    }
  });

  it("refuses the Serbian decimal comma, which is a separator in CSS", () => {
    // `parseToolNumber`'s grammar deliberately does not reach in here.
    expect(parseColour("oklch(0,5 0,1 30)")).toBeNull();
  });

  it("refuses a number whose dot is not followed by a digit", () => {
    // CSS Syntax 3 §4.3.12 consumes the `.` only when a digit follows it, so
    // `1.` is the number 1 plus a delim token and `1.e2` is 1, a delim and an
    // ident — a browser throws the whole declaration away. This file used to
    // read them as 1 and 100.
    expect(parseColour("rgb(1. 2 3)")).toBeNull();
    expect(parseColour("rgb(1.e2 0 0)")).toBeNull();
    expect(parseColour("rgb(50.% 0 0)")).toBeNull();
    expect(parseColour("hsl(120. 100% 50%)")).toBeNull();
    expect(parseColour("rgb(255 0 0 / 1.)")).toBeNull();
    // The spellings CSS does define stay in: a leading dot is optional digits
    // BEFORE the dot, which is a different rule.
    expect(hexOf("rgb(1e2 0 0)")).toBe("#640000");
    expect(hexOf("rgb(255.0 0 0)")).toBe("#ff0000");
    expect(parseColour("rgb(.5 0 0)")).not.toBeNull();
    expect(hexOf("hsl(.5turn 100% 50%)")).toBe("#00ffff");
  });

  it("refuses a legacy comma form that mixes numbers and percentages", () => {
    // CSS Color 4 §8.1 writes `<legacy-rgb-syntax>` as two alternatives —
    // three percentages or three numbers — with no third that mixes them, and
    // `<legacy-hsl-syntax>` fixes saturation and lightness as percentages.
    expect(parseColour("rgb(100%, 0, 0)")).toBeNull();
    expect(parseColour("rgb(255, 0%, 0%)")).toBeNull();
    expect(parseColour("rgba(255, 0, 0%, 0.5)")).toBeNull();
    expect(parseColour("hsl(120, 50, 50)")).toBeNull();
    expect(parseColour("hsl(120, 50%, 50)")).toBeNull();
    expect(parseColour("hsla(120, 50, 50%, 0.5)")).toBeNull();
    // Both homogeneous legacy forms stay legal, the mixture is legal in the
    // modern form where CSS spells each component on its own, and a percentage
    // alpha is legal in the comma form because `<alpha-value>` allows it.
    expect(hexOf("rgb(100%, 0%, 0%)")).toBe("#ff0000");
    expect(hexOf("rgb(255, 0, 0)")).toBe("#ff0000");
    expect(hexOf("rgb(100% 0 0)")).toBe("#ff0000");
    expect(hexOf("rgba(255, 0, 0, 50%)")).toBe("#ff000080");
    expect(hexOf("hsl(120, 100%, 50%)")).toBe("#00ff00");
    expect(hexOf("hsl(120 100 50)")).toBe("#00ff00");
    // The hue guard is a separate rule and stays exactly as it was.
    expect(parseColour("hsl(50%, 100%, 50%)")).toBeNull();
  });
});

describe("formatting and round trips", () => {
  const samples = [
    "#000000",
    "#ffffff",
    "#ff0000",
    "#00ff00",
    "#0000ff",
    "#3366cc",
    "#123456",
    "#7f7f7f",
    "#fedcba",
    "#010203",
    "#c0ffee",
  ];

  for (const format of COLOUR_FORMATS) {
    it(`round-trips every sample through ${format}`, () => {
      for (const hex of samples) {
        const text = formatColour(parsed(hex), format satisfies ColourFormat);
        expect({ hex, text, back: hexOf(text) }).toEqual({ hex, text, back: hex });
      }
    });
  }

  it("round-trips alpha too", () => {
    for (const format of COLOUR_FORMATS) {
      const text = formatColour(parsed("#3366cc80"), format);
      expect(hexOf(text)).toBe("#3366cc80");
    }
  });

  it("writes the modern space syntax, never the comma form", () => {
    expect(formatColour(parsed("#ff0000"), "rgb")).toBe("rgb(255 0 0)");
    expect(formatColour(parsed("#ff0000"), "hsl")).toBe("hsl(0 100% 50%)");
    expect(formatColour(parsed("#ff000080"), "rgb")).toBe("rgb(255 0 0 / 0.50196)");
  });

  it("names one colour per report: every sRGB-bound syntax re-reads as the hex", () => {
    // Defect 1. `hsl()` and `hwb()` were written from channels outside the
    // cube, where HSL's `1 − |2L − 1|` denominator goes negative:
    // `oklch(0.9 0.4 140)` reported hex #00ff00 beside
    // `hsl(117.21 250.352% 30.89%)` and `hwb(117.21 -46.443% -8.223%)`, which a
    // browser repairs into #079e00 and #0cff00 — two colours the tool never
    // computed, in the same report.
    for (const text of ["oklch(0.9 0.4 140)", "lab(100 20 20)"]) {
      const report = convertColour(text);
      expect(report).not.toBeNull();
      if (report === null) return;
      expect(report.inGamut).toBe(false);
      for (const format of ["rgb", "hsl", "hwb"] as const) {
        const emitted = report.formats[format];
        expect({ text, format, reread: hexOf(emitted) }).toEqual({
          text,
          format,
          reread: report.formats.hex,
        });
      }
    }
  });

  it("keeps the wide-gamut syntaxes naming the colour that was typed", () => {
    // The other half of the same rule: `lab()` and the ok- pair CAN name a
    // colour outside sRGB, so clamping them to the gamut would be the tool
    // refusing to write down its own input.
    const report = convertColour("oklch(0.9 0.4 140)");
    expect(report).not.toBeNull();
    if (report === null) return;
    expect(report.formats.oklch).toBe("oklch(0.9 0.4 140)");
    expect(hexOf(report.formats.oklab)).toBe(report.formats.hex);
    expect(isInGamut(parsed(report.formats.lab))).toBe(false);
  });

  it("clamps the lightness a browser would clamp, and leaves the record alone", () => {
    // A colour brighter than white sits past the end of both lightness axes:
    // unclamped, this one writes `lab(113.741 …)` and `oklab(1.11849 …)`, text
    // a browser silently repairs. The string now stops at the top of the axis —
    // exactly where `parseLabFamily` stops — and the record still tells the
    // truth.
    const brighterThanWhite = srgb(1.2, 1.15, 1.1);
    expect(toLab(brighterThanWhite).l).toBeGreaterThan(100);
    expect(toOklab(brighterThanWhite).l).toBeGreaterThan(1);
    expect(formatColour(brighterThanWhite, "lab")).toMatch(/^lab\(100 /);
    expect(formatColour(brighterThanWhite, "lch")).toMatch(/^lch\(100 /);
    expect(formatColour(brighterThanWhite, "oklab")).toMatch(/^oklab\(1 /);
    expect(formatColour(brighterThanWhite, "oklch")).toMatch(/^oklch\(1 /);
  });

  it("decides opacity by the digits it is about to write, not by the alpha behind them", () => {
    // Defect 4. Every alpha from 0,99804 up rounds to `ff`, so asking the raw
    // alpha produced eight digits whose own last pair said „opaque" — and the
    // same shape sat in the ` / a` suffix, where 0,999999 rounds to `1`.
    expect(toHex(srgb(1, 0, 0, 0.999))).toBe("#ff0000");
    expect(toHex(srgb(1, 0, 0, 0.99))).toBe("#ff0000fc");
    expect(toHex(srgb(1, 0, 0, 0.5))).toBe("#ff000080");
    expect(toHex(srgb(1, 0, 0, 0))).toBe("#ff000000");
    expect(formatColour(srgb(1, 0, 0, 0.999999), "rgb")).toBe("rgb(255 0 0)");
    expect(formatColour(srgb(1, 0, 0, 0.999), "rgb")).toBe("rgb(255 0 0 / 0.999)");
  });

  it("keeps an out-of-range alpha out of the string, whatever the caller built", () => {
    expect(formatColour(srgb(1, 0, 0, -0.5), "rgb")).toBe("rgb(255 0 0 / 0)");
    expect(formatColour(srgb(1, 0, 0, 2), "rgb")).toBe("rgb(255 0 0)");
  });

  it("reports every syntax at once, with the gamut verdict beside it", () => {
    const report = convertColour("red");
    expect(report).not.toBeNull();
    if (report === null) return;
    expect(report.inGamut).toBe(true);
    expect(report.name).toBe("red");
    expect(report.formats.hex).toBe("#ff0000");
    expect(report.formats.rgb).toBe("rgb(255 0 0)");
    expect(convertColour("nonsense")).toBeNull();
  });
});

describe("palette — ramps", () => {
  it("walks the tints up and the shades down in perceptual lightness", () => {
    const ramp = tintsAndShades(parsed("#3366cc"), 4);
    expect(ramp).not.toBeNull();
    if (ramp === null) return;
    expect(ramp.tints).toHaveLength(4);
    expect(ramp.shades).toHaveLength(4);

    const baseL = toOklab(parsed("#3366cc")).l;
    const tintL = ramp.tints.map((colour) => toOklab(colour).l);
    const shadeL = ramp.shades.map((colour) => toOklab(colour).l);
    expect(at(tintL, 0)).toBeGreaterThan(baseL);
    expect(at(tintL, 3)).toBeGreaterThan(at(tintL, 2));
    expect(at(tintL, 2)).toBeGreaterThan(at(tintL, 1));
    expect(at(shadeL, 0)).toBeLessThan(baseL);
    expect(at(shadeL, 3)).toBeLessThan(at(shadeL, 2));
  });

  it("refuses a step count that is not a whole number in 1..64", () => {
    const base = parsed("#3366cc");
    for (const steps of [0, -1, 2.5, 65, Number.NaN]) {
      expect(tintsAndShades(base, steps)).toBeNull();
    }
    expect(tintsAndShades(base, 1)).not.toBeNull();
    expect(tintsAndShades(base, 64)).not.toBeNull();
  });
});

describe("palette — harmonies", () => {
  const base = parsed("#ff0000");

  it("puts the base first in every set", () => {
    expect(toHex(at(harmony(base, "complementary"), 0))).toBe("#ff0000");
    expect(toHex(at(harmony(base, "triadic"), 0))).toBe("#ff0000");
    expect(toHex(at(harmony(base, "monochromatic"), 0))).toBe("#ff0000");
  });

  it("rotates hue in OKLCH by the angles each harmony is defined by", () => {
    const baseHue = toOklch(base).h;
    const expected: readonly [string, readonly number[]][] = [
      ["complementary", [0, 180]],
      ["split-complementary", [0, 150, 210]],
      ["analogous", [0, 30, 330]],
      ["triadic", [0, 120, 240]],
      ["tetradic", [0, 90, 180, 270]],
    ];
    for (const [kind, rotations] of expected) {
      const set = harmony(base, kind as "complementary");
      expect(set).toHaveLength(rotations.length);
      rotations.forEach((rotation, index) => {
        const wanted = (baseHue + rotation) % 360;
        // Four decimals of a degree: a rotated partner is often outside the
        // sRGB gamut, and reading its hue back means a round trip through the
        // gamma encoding, which costs about 2 × 10⁻⁶ of a degree at this chroma.
        expect(toOklch(at(set, index)).h).toBeCloseTo(wanted, 4);
      });
    }
  });

  it("holds lightness and chroma steady while the hue moves", () => {
    const source = toOklch(base);
    const partner = toOklch(at(harmony(base, "complementary"), 1));
    expect(partner.l).toBeCloseTo(source.l, 7);
    expect(partner.c).toBeCloseTo(source.c, 7);
  });

  it("varies only lightness for the monochromatic set", () => {
    const set = harmony(base, "monochromatic");
    expect(set).toHaveLength(5);
    const lightness = set.map((colour) => toOklch(colour).l);
    expect(at(lightness, 1)).toBeLessThan(at(lightness, 2));
    expect(at(lightness, 2)).toBeLessThan(at(lightness, 0));
    expect(at(lightness, 0)).toBeLessThan(at(lightness, 3));
    expect(at(lightness, 3)).toBeLessThan(at(lightness, 4));
  });

  it("returns a grey unchanged, because a grey has no hue to rotate", () => {
    const grey = parsed("#808080");
    for (const colour of harmony(grey, "triadic")) {
      expect(toHex(colour)).toBe("#808080");
    }
  });
});

describe("gradient", () => {
  const blackToWhite = [
    { colour: parsed("#000000"), position: 0 },
    { colour: parsed("#ffffff"), position: 1 },
  ];

  it("samples the sRGB midpoint at the arithmetic mean of the channels", () => {
    // 0,5 of a channel is 127,5, which rounds to 128 = 0x80.
    const samples = sampleGradient(
      { kind: "linear", stops: blackToWhite, space: "srgb" },
      3,
    );
    expect(samples).not.toBeNull();
    if (samples === null) return;
    expect(toHex(at(samples, 0))).toBe("#000000");
    expect(toHex(at(samples, 1))).toBe("#808080");
    expect(toHex(at(samples, 2))).toBe("#ffffff");
  });

  it("samples a different, lighter-looking midpoint in Oklab", () => {
    // Oklab L 0,5 is linear 0,125, and 1,055·0,125^(1/2,4) − 0,055 = 0,38857,
    // i.e. 99,09 -> 99 = 0x63. This gap IS the reason the tool offers a space.
    const samples = sampleGradient(
      { kind: "linear", stops: blackToWhite, space: "oklab" },
      3,
    );
    expect(samples).not.toBeNull();
    if (samples === null) return;
    expect(toHex(at(samples, 1))).toBe("#636363");
  });

  it("respects stop positions rather than spacing them evenly", () => {
    const stops = [
      { colour: parsed("#000000"), position: 0 },
      { colour: parsed("#ffffff"), position: 0.25 },
      { colour: parsed("#ffffff"), position: 1 },
    ];
    const samples = sampleGradient({ kind: "linear", stops, space: "srgb" }, 5);
    expect(samples).not.toBeNull();
    if (samples === null) return;
    // At t = 0,25 the ramp is already finished, so everything past it is white.
    expect(toHex(at(samples, 1))).toBe("#ffffff");
    expect(toHex(at(samples, 4))).toBe("#ffffff");
  });

  it("treats two stops at one position as a hard edge", () => {
    const stops = [
      { colour: parsed("#000000"), position: 0 },
      { colour: parsed("#000000"), position: 0.5 },
      { colour: parsed("#ffffff"), position: 0.5 },
      { colour: parsed("#ffffff"), position: 1 },
    ];
    const samples = sampleGradient({ kind: "linear", stops, space: "srgb" }, 3);
    expect(samples).not.toBeNull();
    if (samples === null) return;
    expect(toHex(at(samples, 1))).toBe("#ffffff");
  });

  it("writes the CSS, naming the space only when it is not the default", () => {
    expect(gradientCss({ kind: "linear", stops: blackToWhite, space: "srgb", angleDeg: 90 })).toBe(
      "linear-gradient(90deg, #000000 0%, #ffffff 100%)",
    );
    expect(gradientCss({ kind: "linear", stops: blackToWhite, space: "oklab", angleDeg: 90 })).toBe(
      "linear-gradient(90deg in oklab, #000000 0%, #ffffff 100%)",
    );
    expect(gradientCss({ kind: "radial", stops: blackToWhite, space: "srgb" })).toBe(
      "radial-gradient(#000000 0%, #ffffff 100%)",
    );
    expect(gradientCss({ kind: "conic", stops: blackToWhite, space: "oklab", angleDeg: 45 })).toBe(
      "conic-gradient(from 45deg in oklab, #000000 0%, #ffffff 100%)",
    );
  });

  it("carries alpha into the CSS as an eight-digit hex", () => {
    const stops = [
      { colour: parsed("#ff000080"), position: 0 },
      { colour: parsed("#0000ff"), position: 1 },
    ];
    expect(gradientCss({ kind: "linear", stops, space: "srgb" })).toBe(
      "linear-gradient(#ff000080 0%, #0000ff 100%)",
    );
  });

  it("refuses a gradient that cannot be drawn, and refuses to sort stops for the user", () => {
    const one = [{ colour: parsed("#000000"), position: 0 }];
    const reversed = [
      { colour: parsed("#000000"), position: 1 },
      { colour: parsed("#ffffff"), position: 0 },
    ];
    const outside = [
      { colour: parsed("#000000"), position: -0.1 },
      { colour: parsed("#ffffff"), position: 1 },
    ];
    expect(gradientCss({ kind: "linear", stops: one, space: "srgb" })).toBeNull();
    expect(gradientCss({ kind: "linear", stops: reversed, space: "srgb" })).toBeNull();
    expect(gradientCss({ kind: "linear", stops: outside, space: "srgb" })).toBeNull();
    expect(sampleGradient({ kind: "linear", stops: reversed, space: "srgb" }, 5)).toBeNull();
  });

  it("refuses a sample count below two or above the preview cap", () => {
    const spec = { kind: "linear", stops: blackToWhite, space: "srgb" } as const;
    for (const count of [-1, 0, 1, 2.5, 4097]) {
      expect(sampleGradient(spec, count)).toBeNull();
    }
    expect(sampleGradient(spec, 2)).toHaveLength(2);
  });
});

describe("cubic-bezier easing", () => {
  it("makes cubic-bezier(0, 0, 1, 1) the identity", () => {
    // x(t) = y(t) = −2t³ + 3t², so y as a function of x is the identity.
    for (const time of [0, 0.25, 0.5, 0.75, 1]) {
      expect(easingAt(CSS_EASINGS.linear, time)).toBeCloseTo(time, 6);
    }
  });

  it("matches the hand-solved value of CSS `ease` at the midpoint", () => {
    // x(t) = t³ − 0,75t² + 0,75t = 0,5 at t = 0,69957;
    // y(t) = −1,7t³ + 2,4t² + 0,3t there is 0,80239.
    expect(easingAt(CSS_EASINGS.ease, 0.5)).toBeCloseTo(0.8024, 3);
  });

  it("keeps the symmetric easings symmetric", () => {
    expect(easingAt(CSS_EASINGS["ease-in-out"], 0.5)).toBeCloseTo(0.5, 6);
    const easeIn = easingAt(CSS_EASINGS["ease-in"], 0.3);
    const easeOut = easingAt(CSS_EASINGS["ease-out"], 0.7);
    expect(easeIn).not.toBeNull();
    expect(easeOut).not.toBeNull();
    if (easeIn === null || easeOut === null) return;
    expect(easeIn).toBeCloseTo(1 - easeOut, 6);
  });

  it("solves the flat curve where Newton-Raphson cannot", () => {
    // cubic-bezier(1, 0, 0, 1) has x'(0,5) = 3(2t − 1)² = 0 exactly, which is
    // the case the bisection fallback exists for. x(0,5) = 0,5 and y(0,5) = 0,5.
    const flat: CubicBezierEasing = { x1: 1, y1: 0, x2: 0, y2: 1 };
    expect(easingAt(flat, 0.5)).toBeCloseTo(0.5, 6);
    for (const time of [0.1, 0.2, 0.4, 0.6, 0.8, 0.9]) {
      const progress = easingAt(flat, time);
      expect(progress).not.toBeNull();
      if (progress === null) return;
      expect(Number.isFinite(progress)).toBe(true);
    }
  });

  it("stays monotonic across a legal curve", () => {
    const samples = sampleEasing(CSS_EASINGS.ease, 21);
    expect(samples).not.toBeNull();
    if (samples === null) return;
    expect(samples).toHaveLength(21);
    expect(at(samples, 0)).toEqual({ time: 0, progress: 0 });
    expect(at(samples, 20)).toEqual({ time: 1, progress: 1 });
    for (let i = 1; i < samples.length; i += 1) {
      expect(at(samples, i).progress).toBeGreaterThanOrEqual(at(samples, i - 1).progress - 1e-9);
    }
  });

  it("lets progress overshoot, because that is what a bounce easing is", () => {
    const bounce: CubicBezierEasing = { x1: 0.5, y1: -0.5, x2: 0.5, y2: 1.5 };
    expect(isLegalEasing(bounce)).toBe(true);
    const samples = sampleEasing(bounce, 21);
    expect(samples).not.toBeNull();
    if (samples === null) return;
    expect(samples.some((sample) => sample.progress < 0)).toBe(true);
    expect(samples.some((sample) => sample.progress > 1)).toBe(true);
  });

  it("refuses control points whose x leaves 0..1", () => {
    expect(isLegalEasing({ x1: 1.5, y1: 0, x2: 0.5, y2: 1 })).toBe(false);
    expect(isLegalEasing({ x1: 0.5, y1: 0, x2: -0.1, y2: 1 })).toBe(false);
    expect(isLegalEasing({ x1: Number.NaN, y1: 0, x2: 0.5, y2: 1 })).toBe(false);
    expect(easingAt({ x1: 1.5, y1: 0, x2: 0.5, y2: 1 }, 0.5)).toBeNull();
    expect(sampleEasing({ x1: 1.5, y1: 0, x2: 0.5, y2: 1 }, 5)).toBeNull();
  });

  it("refuses a time outside 0..1", () => {
    for (const time of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(easingAt(CSS_EASINGS.ease, time)).toBeNull();
    }
  });
});

describe("contrast — WCAG 2.1", () => {
  it("gives black on white the maximum 21:1", () => {
    expect(contrastRatio(parsed("#000000"), parsed("#ffffff"))).toBeCloseTo(21, 10);
  });

  it("is order-independent", () => {
    const a = parsed("#123456");
    const b = parsed("#fedcba");
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 12);
  });

  it("reads white's relative luminance as 1 and black's as 0", () => {
    expect(relativeLuminance(parsed("#ffffff"))).toBeCloseTo(1, 12);
    expect(relativeLuminance(parsed("#000000"))).toBe(0);
  });

  it("puts the AA body boundary between #767676 and #777777 on white", () => {
    // Hand-derived: L(#767676) = 0,181164 -> 1,05 / 0,231164 = 4,5422
    //               L(#777777) = 0,184475 -> 1,05 / 0,234475 = 4,4783
    const white = parsed("#ffffff");
    const passing = contrastReport(parsed("#767676"), white);
    const failing = contrastReport(parsed("#777777"), white);
    expect(passing.ratio).toBeCloseTo(4.54, 2);
    expect(failing.ratio).toBeCloseTo(4.48, 2);
    expect(passing.aaBody).toBe(true);
    expect(failing.aaBody).toBe(false);
    expect(failing.aaLarge).toBe(true);
    expect(failing.nonText).toBe(true);
    expect(passing.aaaBody).toBe(false);
  });

  it("agrees with the repo's own contrast gate, constant for constant", () => {
    // `scripts/check-contrast.mjs` carries a second copy of this arithmetic and
    // decides whether the token palette ships. These figures come from running
    // ITS `contrast()` — if a change here moves them, the two implementations
    // have drifted and the gate is now measuring something the app does not.
    const oracle: readonly [string, string, number][] = [
      ["#000000", "#ffffff", 21.0],
      ["#767676", "#ffffff", 4.542225],
      ["#777777", "#ffffff", 4.478089],
      ["#123456", "#fedcba", 9.786559],
      ["#3366cc", "#ffffff", 5.366402],
    ];
    for (const [a, b, expected] of oracle) {
      expect(contrastRatio(parsed(a), parsed(b))).toBeCloseTo(expected, 6);
    }
    expect(relativeLuminance(parsed("#767676"))).toBeCloseTo(0.181164244, 9);
  });

  it("clears AAA where it should", () => {
    const report = contrastReport(parsed("#000000"), parsed("#ffffff"));
    expect(report.aaaBody).toBe(true);
    expect(report.aaaLarge).toBe(true);
  });
});

describe("contrast — APCA", () => {
  it("matches the published Lc for black text on white", () => {
    // Soft-clamped black is 0,022^1,414 = 0,0045288; (1^0,56 − 0,0045288^0,57)
    // · 1,14 − 0,027 = 1,06042, i.e. Lc 106,04.
    expect(apcaLc(parsed("#000000"), parsed("#ffffff"))).toBeCloseTo(106.04, 1);
  });

  it("matches the published Lc for white text on black, and it is negative", () => {
    // (0,0045288^0,65 − 1^0,62) · 1,14 + 0,027 = −1,07889, i.e. Lc −107,89.
    expect(apcaLc(parsed("#ffffff"), parsed("#000000"))).toBeCloseTo(-107.89, 1);
  });

  it("is asymmetric, which is the whole reason it sits beside the WCAG ratio", () => {
    const dark = parsed("#111111");
    const light = parsed("#eeeeee");
    const forwards = apcaLc(dark, light);
    const backwards = apcaLc(light, dark);
    expect(forwards).toBeGreaterThan(0);
    expect(backwards).toBeLessThan(0);
    expect(Math.abs(forwards)).not.toBeCloseTo(Math.abs(backwards), 2);
    // WCAG, by contrast, cannot tell the two apart at all.
    expect(contrastRatio(dark, light)).toBeCloseTo(contrastRatio(light, dark), 12);
  });

  it("answers zero for a pair with nothing between them", () => {
    expect(apcaLc(parsed("#808080"), parsed("#808080"))).toBe(0);
  });

  it("is carried in the same report as the WCAG verdict", () => {
    const report = contrastReport(parsed("#000000"), parsed("#ffffff"));
    expect(report.apcaLc).toBeCloseTo(106.04, 1);
    expect(report.ratio).toBeCloseTo(21, 10);
  });
});

describe("mixer", () => {
  const red = parsed("#ff0000");
  const white = parsed("#ffffff");
  const black = parsed("#000000");

  function half(a: Srgb, b: Srgb, space: "srgb" | "linear-rgb" | "oklab"): string {
    const mixed = mixColours(
      [
        { colour: a, weight: 1 },
        { colour: b, weight: 1 },
      ],
      space,
    );
    if (mixed === null) throw new Error("expected a mix");
    return toHex(mixed);
  }

  it("gives three different answers for the same pair, which is the point", () => {
    const answers = [
      half(red, white, "srgb"),
      half(red, white, "linear-rgb"),
      half(red, white, "oklab"),
    ];
    expect(new Set(answers).size).toBe(3);
  });

  it("mixes sRGB as the arithmetic mean of the encoded channels", () => {
    // g = b = 0,5 -> 127,5 -> 128 = 0x80.
    expect(half(red, white, "srgb")).toBe("#ff8080");
    expect(half(black, white, "srgb")).toBe("#808080");
  });

  it("mixes linear RGB in light, which comes out markedly lighter", () => {
    // Linear 0,5 encodes to 1,055·0,5^(1/2,4) − 0,055 = 0,735357 -> 187,52 -> 188 = 0xbc.
    expect(half(black, white, "linear-rgb")).toBe("#bcbcbc");
  });

  it("mixes Oklab on the perceptual lightness axis", () => {
    // Oklab L 0,5 is linear 0,125 -> encoded 0,388573 -> 99,09 -> 99 = 0x63.
    expect(half(black, white, "oklab")).toBe("#636363");
  });

  it("honours the weights", () => {
    const mixed = mixColours(
      [
        { colour: black, weight: 3 },
        { colour: white, weight: 1 },
      ],
      "srgb",
    );
    expect(mixed).not.toBeNull();
    if (mixed === null) return;
    // 0,25 of a channel is 63,75 -> 64 = 0x40.
    expect(toHex(mixed)).toBe("#404040");
  });

  it("premultiplies alpha, so a transparent partner contributes only its alpha", () => {
    // Without premultiplication this comes out olive: the transparent colour's
    // green would drag a colour nobody can see into the answer.
    const transparentLime = srgb(0, 1, 0, 0);
    const mixed = mixColours(
      [
        { colour: red, weight: 1 },
        { colour: transparentLime, weight: 1 },
      ],
      "srgb",
    );
    expect(mixed).not.toBeNull();
    if (mixed === null) return;
    expect(mixed.r).toBeCloseTo(1, 12);
    expect(mixed.g).toBeCloseTo(0, 12);
    expect(mixed.alpha).toBeCloseTo(0.5, 12);
  });

  it("refuses a mix that has no answer", () => {
    expect(mixColours([], "srgb")).toBeNull();
    expect(mixColours([{ colour: red, weight: -1 }], "srgb")).toBeNull();
    expect(mixColours([{ colour: red, weight: Number.NaN }], "srgb")).toBeNull();
    expect(
      mixColours(
        [
          { colour: red, weight: 0 },
          { colour: white, weight: 0 },
        ],
        "srgb",
      ),
    ).toBeNull();
  });

  it("composites source-over, which is not the same operation as mixing", () => {
    const halfBlack = srgb(0, 0, 0, 0.5);
    const over = compositeOver(halfBlack, white);
    expect(over.alpha).toBe(1);
    expect(toHex(over)).toBe("#808080");
    // The same pair MIXED 50/50 is the same grey here only by coincidence of the
    // inputs; with a coloured backdrop the two diverge.
    const overRed = compositeOver(srgb(0, 0, 1, 0.5), red);
    expect(toHex(overRed)).toBe("#800080");
  });

  it("leaves the backdrop alone under a fully transparent source", () => {
    expect(toHex(compositeOver(srgb(0, 1, 0, 0), red))).toBe("#ff0000");
  });

  it("replaces the backdrop under an opaque source", () => {
    const over = compositeOver(red, white);
    expect(toHex(over)).toBe("#ff0000");
    expect(over.alpha).toBe(1);
  });

  it("answers transparent black when nothing is opaque at all", () => {
    const over = compositeOver(srgb(1, 0, 0, 0), srgb(0, 0, 1, 0));
    expect(over.alpha).toBe(0);
  });
});

describe("HSL and HWB record conversions", () => {
  it("round-trips through the HSL record", () => {
    for (const hex of ["#ff0000", "#3366cc", "#010203", "#ffffff", "#000000"]) {
      expect(toHex(fromHsl(toHsl(parsed(hex))))).toBe(hex);
    }
  });

  it("reports a grey as having no saturation and no hue", () => {
    const grey = toHsl(parsed("#808080"));
    expect(grey.s).toBe(0);
    expect(grey.h).toBe(0);
  });
});
