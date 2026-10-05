/**
 * „Dizajn i boje" — the English copy of this category's tool surfaces.
 *
 * One entry per tool id, keyed exactly as the registration in
 * `shared/modules.ts` spells it. The tool's NAME and its one-line blurb are not
 * here: those live in the `name` and `blurb` tables of `./devtools.en.ts`, because
 * the drawer's rail needs them before any surface is opened.
 *
 * **No CSS colour syntax appears anywhere in this file, on purpose.** The repo's
 * `check:colours` gate flags any `#hex` or `rgb(`/`hsl(`/`oklch(`/… substring in
 * application source, and an example placeholder that showed one (`„npr. #36c"`)
 * would trip it just as surely as a hard-coded style would. Every hint below
 * names the syntaxes by word instead of demonstrating one.
 */
export const DEVTOOLS_DESIGN_EN = {
  "color-convert": {
    input: "Colour",
    inputPlaceholder: "e.g. hex, rgb, hsl, hwb, lab, lch, oklab, oklch",
    invalid: "Colour notation not recognised.",
    name: "Name",
    noName: "No CSS name",
    outOfGamut: "Outside the sRGB gamut — hex, rgb, hsl and hwb are approximate.",
    formats: {
      hex: "Hex",
      rgb: "RGB",
      hsl: "HSL",
      hwb: "HWB",
      lab: "Lab",
      lch: "LCH",
      oklab: "Oklab",
      oklch: "Oklch",
    },
  },

  "color-palette": {
    base: "Base colour",
    basePlaceholder: "A colour in any CSS notation",
    steps: "Number of steps",
    invalidSteps: "Enter a whole number from 1 to 64.",
    invalid: "Colour notation not recognised.",
    tints: "Lighter shades",
    shades: "Darker shades",
    harmony: "Harmony",
    greyNote: "Grey has no hue to rotate — harmony returns it unchanged.",
    kind: {
      complementary: "Complementary",
      "split-complementary": "Split complementary",
      analogous: "Analogous",
      triadic: "Triadic",
      tetradic: "Tetradic",
      monochromatic: "Monochromatic",
    },
  },

  gradient: {
    kind: "Kind",
    kindLabel: {
      linear: "Linear",
      radial: "Radial",
      conic: "Conic",
    },
    stops: "Gradient stops",
    addStop: "Add stop",
    removeStop: "Remove stop",
    colour: "Colour",
    position: "Position (%)",
    space: "Interpolation space",
    spaceLabel: {
      srgb: "sRGB",
      oklab: "Oklab",
    },
    spaceHint:
      "In the Oklab space the middle of the gradient does not pass through grey as it does in sRGB.",
    angle: "Angle (°)",
    samples: "Number of samples",
    css: "CSS",
    invalid: "Colour notation not recognised.",
    invalidStops:
      "Stops must run in order, from 0% to 100%, and there must be at least two.",
    invalidSamples: "The number of samples must be a whole number from 2 to 4096.",
  },

  "cubic-bezier": {
    preset: "Preset curve",
    custom: "Custom",
    x1: "P1 x",
    y1: "P1 y",
    x2: "P2 x",
    y2: "P2 y",
    time: "Time",
    progress: "Progress",
    samples: "Number of samples",
    css: "CSS",
    illegal: "The x coordinates of the control points must be between 0 and 1.",
    invalidTime: "Time must be between 0 and 1.",
    invalidSamples: "The number of samples must be a whole number from 2 to 4096.",
    overshoot: "Progress runs outside 0–1 — that is an overshoot, not an error.",
    referenceTitle: "Compare with preset curves",
  },

  contrast: {
    text: "Text colour",
    background: "Background colour",
    swap: "Swap",
    preview: "This is how the text looks",
    ratio: "Contrast ratio",
    apca: "APCA Lc",
    pass: "Passes",
    fail: "Fails",
    invalid: "Colour notation not recognised.",
    level: {
      aaBody: "AA — normal text",
      aaLarge: "AA — large text",
      aaaBody: "AAA — normal text",
      aaaLarge: "AAA — large text",
      nonText: "AA — icons and lines",
    },
    apcaHint:
      "A negative value means light text on a dark background. WCAG 2.1 does not distinguish that direction and as a rule overestimates it.",
    alphaHint: "WCAG does not know transparent text — put a background behind it first.",
  },

  "color-mixer": {
    colours: "Colours",
    addColour: "Add colour",
    removeColour: "Remove colour",
    weight: "Weight",
    spaceLabel: {
      srgb: "sRGB",
      "linear-rgb": "Linear RGB",
      oklab: "Oklab",
    },
    result: "Result",
    invalid: "Colour notation not recognised.",
    invalidWeight:
      "Each weight must be a number greater than or equal to zero, and the sum greater than zero.",
    composite: "Blending",
    source: "Top colour",
    backdrop: "Bottom colour",
    compositeHint: "Alpha compositing is not the same as weighted mixing.",
  },
} as const;
