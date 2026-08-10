/**
 * The colour engine behind the developer drawer's six colour tools —
 * conversion between every CSS colour syntax, palettes, gradients, the
 * cubic-Bézier easing curve, contrast and mixing.
 *
 * **Why one module.** All six answer the same question from different angles:
 * *what will this actually look like, without a browser to ask.* A gradient
 * preview, an easing preview and a palette swatch are all „sample a curve and
 * hand me colours"; splitting them across files would have duplicated the
 * colour-space maths four times, and duplicated maths drifts. The easing curve
 * is here for exactly that reason and no other — it is not a colour, it is the
 * other thing a preview has to be sampled from.
 *
 * **The canonical form is gamma-encoded sRGB, and it is NOT clamped.** Every
 * parse lands in `Srgb` and every format leaves from it. Channels outside 0..1
 * are kept rather than squashed, because `oklch(0.8 0.3 150)` is a real colour
 * that sRGB cannot show, and a tool whose job is to tell you that must not
 * first destroy the evidence. The sign-extended transfer functions
 * (`srgbToLinear`/`linearToSrgb`) make the out-of-range round trip exact, so
 * nothing is lost on the way through — `isInGamut` is then a question the
 * caller asks, not a fact the pipeline already decided.
 *
 * **Where this file breaks the drawer's „refuse, do not repair" rule, and
 * why.** The other tools parse what a PERSON typed, so a value they cannot
 * stand behind is refused. This one parses CSS, and its job is to report what a
 * BROWSER will do with the text. A browser clamps: `rgb(300 0 0)` is red,
 * `lch(120 …)` is `lch(100 …)`, alpha above 1 is 1. Refusing text every browser
 * accepts would be the tool lying about the language it claims to explain, so
 * clamping is done where CSS clamps and NOWHERE else. Syntax it does not admit
 * is still refused flat: `null`, never a guess.
 *
 * **The same rule runs backwards through every formatter, and it runs through
 * all eight of them.** A string this file emits is one a browser reads back as
 * the value written here, so each syntax is written from the colour it is able
 * to name: the four that cannot leave sRGB — hex, `rgb()`, `hsl()`, `hwb()` —
 * are written from `clampedToGamut`, and the four that can leave it clamp only
 * the component CSS clamps, which is lightness. `inGamut` is how the caller is
 * told the first four are an approximation; it was never a licence to emit
 * `hsl(117.21 250.352% 30.89%)` and let the browser repair it into a colour
 * this file never computed.
 *
 * **What it refuses outright.** The `none` keyword for missing components
 * (CSS Color 4 carries „no hue" through interpolation; this tool has no such
 * concept and inventing 0 would be wrong at every gradient midpoint),
 * `currentcolor` (there is no element here to inherit from), `color()` with an
 * explicit colour space, relative colour syntax, and colour functions nested
 * inside one another. Grouping-comma decimals are refused too — CSS numbers use
 * a dot, and the drawer's Serbian comma grammar (`parseToolNumber`) is a
 * different language that deliberately does not reach in here.
 *
 * **CIELAB is D50-referred on the CSS surface and D65-referred underneath.**
 * `xyzToLab`/`labToXyz` take a white point and default to D65, which is what
 * colour-science texts and Ottosson's Oklab derivation mean by „Lab". CSS's
 * `lab()`/`lch()` are D50-referred, so `toLab`/`toLch` adapt through Bradford
 * first. Getting this wrong is not subtle-but-harmless: it puts `lab()` of red
 * about two units of L and four of a away from what every browser prints, which
 * is precisely the sort of quietly-wrong number a converter exists to prevent.
 * The matrices for both halves of that trip come from ONE authority — CSS Color
 * 4's `conversions.js` — because the smaller version of the same mistake is to
 * take the sRGB matrix from a source derived against one D65 and the Bradford
 * adaptation from a source derived against another; see
 * `LINEAR_SRGB_TO_XYZ_D65`.
 *
 * **Nothing here rounds except the string formatters**, and they round to a
 * precision chosen so that hex → any format → hex is exact for all 8-bit
 * colours. The numbers in the returned records are the arithmetic's own.
 */

/* -------------------------------------------------------------------------- */
/* Small shared arithmetic                                                     */
/* -------------------------------------------------------------------------- */

/** A three-component colour coordinate. A tuple so the matrix code indexes without a bounds check. */
export type Vec3 = readonly [number, number, number];

/** A 3×3 row-major matrix. */
type Matrix3 = readonly [Vec3, Vec3, Vec3];

function multiply(m: Matrix3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** Degrees folded into 0..360. Written as two modulos so that −0 comes back as 0. */
function normaliseHue(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/* -------------------------------------------------------------------------- */
/* Colour records                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The canonical colour: gamma-encoded sRGB.
 *
 * `r`/`g`/`b` are nominally 0..1 but are deliberately unbounded — a colour
 * parsed from `oklch()` or `lab()` can sit outside the sRGB gamut and this
 * record keeps it there until someone asks for a hex string.
 */
export interface Srgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** Always 0..1: alpha is the one component CSS itself clamps at parse time. */
  readonly alpha: number;
}

/** CIE XYZ, relative to whichever white point produced it. */
export interface Xyz {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly alpha: number;
}

/** CIELAB. `l` 0..100, `a`/`b` roughly ±128. */
export interface Lab {
  readonly l: number;
  readonly a: number;
  readonly b: number;
  readonly alpha: number;
}

/** CIELCH — CIELAB in polar form. `h` in degrees, 0..360. */
export interface Lch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
  readonly alpha: number;
}

/** Oklab. `l` 0..1, `a`/`b` roughly ±0.4. */
export interface Oklab {
  readonly l: number;
  readonly a: number;
  readonly b: number;
  readonly alpha: number;
}

/** Oklch — Oklab in polar form. `h` in degrees, 0..360. */
export interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
  readonly alpha: number;
}

/** HSL as CSS spells it: `h` degrees, `s`/`l` percentages 0..100. */
export interface Hsl {
  readonly h: number;
  readonly s: number;
  readonly l: number;
  readonly alpha: number;
}

/** HWB as CSS spells it: `h` degrees, `w` (whiteness) and `b` (blackness) percentages. */
export interface Hwb {
  readonly h: number;
  readonly w: number;
  readonly b: number;
  readonly alpha: number;
}

/** A colour from components, with alpha defaulting to opaque. */
export function srgb(r: number, g: number, b: number, alpha = 1): Srgb {
  return { r, g, b, alpha };
}

/** Whether every channel lands inside the sRGB cube, within one part in a million of a channel. */
export function isInGamut(colour: Srgb): boolean {
  const slack = 1e-6;
  return [colour.r, colour.g, colour.b].every(
    (channel) => channel >= -slack && channel <= 1 + slack,
  );
}

/* -------------------------------------------------------------------------- */
/* sRGB transfer function                                                      */
/* -------------------------------------------------------------------------- */

/** The knee, slope, exponent and offset of the sRGB transfer function (IEC 61966-2-1). */
const SRGB_KNEE_ENCODED = 0.04045;
const SRGB_SLOPE = 12.92;
const SRGB_EXPONENT = 2.4;
const SRGB_OFFSET = 0.055;

/**
 * The knee on the LINEAR side, derived rather than quoted.
 *
 * The standard publishes both knees — 0,04045 encoded and 0,0031308 linear —
 * and they are not each other's inverse: 0,0031308 × 12,92 is 0,040449936, so
 * quoting both leaves a sliver either side of the knee where the two functions
 * take opposite branches and disagree by about 3 × 10⁻⁸. That is small, and it
 * is also two hundred times a double's precision, which makes it a real
 * asymmetry rather than float noise — `linearToSrgb(srgbToLinear(0.04045))` came
 * back 0,040449970 with the quoted pair. Dividing the encoded knee by the slope
 * makes the branch choice agree by construction and the round trip exact.
 */
const SRGB_KNEE_LINEAR = SRGB_KNEE_ENCODED / SRGB_SLOPE;

/**
 * One gamma-encoded channel to linear light.
 *
 * Sign-extended — `f(−x) = −f(x)` — which is not what IEC 61966-2-1 says and IS
 * what CSS Color 4 says, for the reason that matters here: a wide-gamut colour
 * has negative sRGB components, and a transfer function that folded them to
 * zero would make the round trip through linear light lossy for exactly the
 * colours this tool exists to describe.
 */
export function srgbToLinear(channel: number): number {
  const sign = channel < 0 ? -1 : 1;
  const c = Math.abs(channel);
  const linear =
    c <= SRGB_KNEE_ENCODED
      ? c / SRGB_SLOPE
      : ((c + SRGB_OFFSET) / (1 + SRGB_OFFSET)) ** SRGB_EXPONENT;
  return sign * linear;
}

/**
 * One linear-light channel back to gamma-encoded sRGB. The inverse of
 * `srgbToLinear`, exact everywhere a double can be exact.
 *
 * The one place it is not is the very top: `1.055 * 1 - 0.055` is
 * 0,9999999999999999, because neither 1,055 nor 0,055 is representable in
 * binary. Rewriting the expression to force a 1 there would mean not using the
 * published formula, which is a worse trade — the artefact is one unit in the
 * last place, it is below every rounding this file does (255 × that value still
 * rounds to 255), and it is named here so nobody spends an afternoon on it.
 */
export function linearToSrgb(channel: number): number {
  const sign = channel < 0 ? -1 : 1;
  const c = Math.abs(channel);
  const encoded =
    c <= SRGB_KNEE_LINEAR
      ? c * SRGB_SLOPE
      : (1 + SRGB_OFFSET) * c ** (1 / SRGB_EXPONENT) - SRGB_OFFSET;
  return sign * encoded;
}

function toLinearVec(colour: Srgb): Vec3 {
  return [srgbToLinear(colour.r), srgbToLinear(colour.g), srgbToLinear(colour.b)];
}

function fromLinearVec(linear: Vec3, alpha: number): Srgb {
  return {
    r: linearToSrgb(linear[0]),
    g: linearToSrgb(linear[1]),
    b: linearToSrgb(linear[2]),
    alpha,
  };
}

/* -------------------------------------------------------------------------- */
/* Linear sRGB ⇄ CIE XYZ (D65)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Linear sRGB to CIE XYZ, D65-referred.
 *
 * CSS Color 4's `conversions.js` — the specification's own sample code, which is
 * what browsers are checked against — written as the exact rationals it
 * publishes rather than as decimals, so a reviewer can compare them to the
 * source term for term.
 *
 * This was Bruce Lindbloom's sRGB/D65 matrix until it was measured. Lindbloom
 * derives against CIE's D65 of (0.95047, 1, 1.08883); the Bradford adaptation
 * below is CSS's, derived against the chromaticity D65 of (0.9504559, 1,
 * 1.0890578). Two conventions in one pipeline is not a rounding difference — it
 * printed `lab(54.294 80.806 69.891)` for red where a browser prints
 * `lab(54.291 80.805 69.891)`, and it printed it in the third decimal, which is
 * a digit `formatColour` chose to show. One authority throughout is the fix.
 */
const LINEAR_SRGB_TO_XYZ_D65: Matrix3 = [
  [506752 / 1228815, 87881 / 245763, 12673 / 70218],
  [87098 / 409605, 175762 / 245763, 12673 / 175545],
  [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
];

/**
 * The inverse of `LINEAR_SRGB_TO_XYZ_D65`, from the same listing. Rationals
 * again, and their product with the matrix above is the identity to within one
 * unit in the last place — which quoted six-decimal inverses are not.
 */
const XYZ_D65_TO_LINEAR_SRGB: Matrix3 = [
  [12831 / 3959, -329 / 214, -1974 / 3959],
  [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
  [705 / 12673, -2585 / 12673, 705 / 667],
];

/**
 * The D65 white point, taken as the ROW SUMS of the matrix above rather than as
 * CSS Color 4's published (0.9504559270516716, 1, 1.0890577507598784).
 *
 * They agree to within one unit in the last place — the matrix is derived from
 * that very white point — and the difference is the whole point: a white point
 * read off the matrix is self-consistent with it BY CONSTRUCTION, so `#ffffff`
 * comes out at exactly L* = 100, a* = 0, b* = 0. Take the published triple
 * instead and white acquires a small non-zero a*, which is the kind of defect
 * that survives review because it looks like float noise and is in fact a
 * mismatched constant.
 */
export const D65_WHITE: Vec3 = [
  LINEAR_SRGB_TO_XYZ_D65[0][0] + LINEAR_SRGB_TO_XYZ_D65[0][1] + LINEAR_SRGB_TO_XYZ_D65[0][2],
  LINEAR_SRGB_TO_XYZ_D65[1][0] + LINEAR_SRGB_TO_XYZ_D65[1][1] + LINEAR_SRGB_TO_XYZ_D65[1][2],
  LINEAR_SRGB_TO_XYZ_D65[2][0] + LINEAR_SRGB_TO_XYZ_D65[2][1] + LINEAR_SRGB_TO_XYZ_D65[2][2],
];

/** Bradford chromatic adaptation, D65 → D50, from the same `conversions.js` listing as the matrix above. */
const XYZ_D65_TO_D50: Matrix3 = [
  [1.0479298208405488, 0.022946793341019088, -0.05019222954313557],
  [0.029627815688159344, 0.990434484573249, -0.01707382502938514],
  [-0.009243058152591178, 0.015055144896577895, 0.7518742899580008],
];

/** Bradford chromatic adaptation, D50 → D65. The inverse of the pair above. */
const XYZ_D50_TO_D65: Matrix3 = [
  [0.9554734527042182, -0.023098536874261423, 0.0632593086610217],
  [-0.028369706963208136, 1.0099954580058226, 0.021041398966943008],
  [0.012314001688319899, -0.020507696433477912, 1.3303659366080753],
];

/**
 * D50, adapted from `D65_WHITE` so the same self-consistency argument holds on
 * the D50 side.
 *
 * It reproduces CSS Color 4's fixed D50 of (0.9642956764295677, 1,
 * 0.8251046025104602) to five parts in a hundred million, the residue being the
 * Bradford matrix's own rounding. That moves L* by about 1,4 × 10⁻⁶ — four
 * orders below the third decimal `formatColour` prints — and buys the exact
 * neutrality of white, which quoting the fixed triple here would cost.
 */
export const D50_WHITE: Vec3 = multiply(XYZ_D65_TO_D50, D65_WHITE);

/** Linear sRGB to XYZ, D65-referred. */
export function linearRgbToXyz(linear: Vec3): Vec3 {
  return multiply(LINEAR_SRGB_TO_XYZ_D65, linear);
}

/** D65 XYZ back to linear sRGB. Components may fall outside 0..1 for a colour sRGB cannot show. */
export function xyzToLinearRgb(xyz: Vec3): Vec3 {
  return multiply(XYZ_D65_TO_LINEAR_SRGB, xyz);
}

/* -------------------------------------------------------------------------- */
/* XYZ ⇄ CIELAB                                                                */
/* -------------------------------------------------------------------------- */

/** CIELAB's δ = 6/29, and the constants derived from it (CIE 15:2004). */
const LAB_DELTA = 6 / 29;
const LAB_DELTA_CUBED = LAB_DELTA ** 3;
const LAB_LINEAR_SLOPE = 3 * LAB_DELTA ** 2;
const LAB_LINEAR_OFFSET = 4 / 29;

function labF(t: number): number {
  return t > LAB_DELTA_CUBED ? Math.cbrt(t) : t / LAB_LINEAR_SLOPE + LAB_LINEAR_OFFSET;
}

function labFInverse(f: number): number {
  return f > LAB_DELTA ? f ** 3 : (f - LAB_LINEAR_OFFSET) * LAB_LINEAR_SLOPE;
}

/**
 * XYZ to CIELAB against `white`, which defaults to D65.
 *
 * D65 by default because that is what „Lab" means outside CSS — every
 * colour-difference formula, and Ottosson's Oklab derivation, are stated
 * against it. CSS's own `lab()` is D50-referred and reaches this through
 * `toLab`, which adapts first.
 */
export function xyzToLab(xyz: Vec3, white: Vec3 = D65_WHITE): Vec3 {
  const fx = labF(xyz[0] / white[0]);
  const fy = labF(xyz[1] / white[1]);
  const fz = labF(xyz[2] / white[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIELAB back to XYZ against `white`. The exact inverse of `xyzToLab`. */
export function labToXyz(lab: Vec3, white: Vec3 = D65_WHITE): Vec3 {
  const fy = (lab[0] + 16) / 116;
  const fx = fy + lab[1] / 500;
  const fz = fy - lab[2] / 200;
  return [labFInverse(fx) * white[0], labFInverse(fy) * white[1], labFInverse(fz) * white[2]];
}

/* -------------------------------------------------------------------------- */
/* Linear sRGB ⇄ Oklab                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Linear sRGB to Oklab's cone-response (LMS) basis.
 *
 * Björn Ottosson, „A perceptual color space for image processing" (2020) —
 * the `linear_srgb_to_oklab` listing in the published article. These are the
 * sRGB-specific numbers, already folded through XYZ; they are NOT the
 * XYZ → LMS matrix from the same article and must not be swapped for it.
 */
const LINEAR_SRGB_TO_LMS: Matrix3 = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
];

/** Cube-rooted LMS to Oklab. Same source, same listing. */
const LMS_TO_OKLAB: Matrix3 = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
];

/** Oklab back to cube-rooted LMS — Ottosson's `oklab_to_linear_srgb` listing, first half. */
const OKLAB_TO_LMS: Matrix3 = [
  [1, 0.3963377774, 0.2158037573],
  [1, -0.1055613458, -0.0638541728],
  [1, -0.0894841775, -1.291485548],
];

/** Cubed LMS back to linear sRGB — the same listing, second half. */
const LMS_TO_LINEAR_SRGB: Matrix3 = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.707614701],
];

/**
 * Linear sRGB to Oklab.
 *
 * `Math.cbrt` rather than `** (1/3)`, because the LMS values go negative for
 * colours outside the sRGB gamut and `(-0.1) ** (1/3)` is `NaN` — a silent
 * conversion to „not a colour" exactly where the tool is supposed to be
 * describing an out-of-gamut one.
 */
export function linearRgbToOklab(linear: Vec3): Vec3 {
  const lms = multiply(LINEAR_SRGB_TO_LMS, linear);
  return multiply(LMS_TO_OKLAB, [Math.cbrt(lms[0]), Math.cbrt(lms[1]), Math.cbrt(lms[2])]);
}

/** Oklab back to linear sRGB. The exact inverse of `linearRgbToOklab`. */
export function oklabToLinearRgb(oklab: Vec3): Vec3 {
  const root = multiply(OKLAB_TO_LMS, oklab);
  return multiply(LMS_TO_LINEAR_SRGB, [root[0] ** 3, root[1] ** 3, root[2] ** 3]);
}

/* -------------------------------------------------------------------------- */
/* Rectangular ⇄ polar                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A Lab-shaped pair to its polar form.
 *
 * A grey has chroma zero and therefore NO hue; this reports 0 rather than
 * refusing, because `atan2(0, 0)` is 0 and every rotation of nothing is still
 * nothing. Callers that rotate hue (the harmony tool) have to know that a grey
 * base yields identical outputs — that is a true answer, not a bug.
 */
function toPolar(a: number, b: number): { readonly c: number; readonly h: number } {
  return { c: Math.hypot(a, b), h: normaliseHue((Math.atan2(b, a) * 180) / Math.PI) };
}

function toRectangular(c: number, h: number): { readonly a: number; readonly b: number } {
  const radians = (h * Math.PI) / 180;
  return { a: c * Math.cos(radians), b: c * Math.sin(radians) };
}

/* -------------------------------------------------------------------------- */
/* Public conversions off the canonical Srgb                                   */
/* -------------------------------------------------------------------------- */

/** sRGB to D65 XYZ. */
export function toXyz(colour: Srgb): Xyz {
  const [x, y, z] = linearRgbToXyz(toLinearVec(colour));
  return { x, y, z, alpha: colour.alpha };
}

/** D65 XYZ back to sRGB. */
export function fromXyz(xyz: Xyz): Srgb {
  return fromLinearVec(xyzToLinearRgb([xyz.x, xyz.y, xyz.z]), xyz.alpha);
}

/**
 * sRGB to CIELAB **as CSS's `lab()` means it** — D50-referred, reached by
 * Bradford-adapting the D65 XYZ first. See the module comment: the D65 answer
 * is a different (and, for CSS, wrong) set of numbers.
 */
export function toLab(colour: Srgb): Lab {
  const d50 = multiply(XYZ_D65_TO_D50, linearRgbToXyz(toLinearVec(colour)));
  const [l, a, b] = xyzToLab(d50, D50_WHITE);
  return { l, a, b, alpha: colour.alpha };
}

/** CSS `lab()` back to sRGB. */
export function fromLab(lab: Lab): Srgb {
  const d65 = multiply(XYZ_D50_TO_D65, labToXyz([lab.l, lab.a, lab.b], D50_WHITE));
  return fromLinearVec(xyzToLinearRgb(d65), lab.alpha);
}

/** sRGB to CSS `lch()`. */
export function toLch(colour: Srgb): Lch {
  const lab = toLab(colour);
  const { c, h } = toPolar(lab.a, lab.b);
  return { l: lab.l, c, h, alpha: colour.alpha };
}

/** CSS `lch()` back to sRGB. */
export function fromLch(lch: Lch): Srgb {
  const { a, b } = toRectangular(lch.c, lch.h);
  return fromLab({ l: lch.l, a, b, alpha: lch.alpha });
}

/** sRGB to Oklab. */
export function toOklab(colour: Srgb): Oklab {
  const [l, a, b] = linearRgbToOklab(toLinearVec(colour));
  return { l, a, b, alpha: colour.alpha };
}

/** Oklab back to sRGB. */
export function fromOklab(oklab: Oklab): Srgb {
  return fromLinearVec(oklabToLinearRgb([oklab.l, oklab.a, oklab.b]), oklab.alpha);
}

/** sRGB to Oklch. */
export function toOklch(colour: Srgb): Oklch {
  const oklab = toOklab(colour);
  const { c, h } = toPolar(oklab.a, oklab.b);
  return { l: oklab.l, c, h, alpha: colour.alpha };
}

/** Oklch back to sRGB. */
export function fromOklch(oklch: Oklch): Srgb {
  const { a, b } = toRectangular(oklch.c, oklch.h);
  return fromOklab({ l: oklch.l, a, b, alpha: oklch.alpha });
}

/** The hue of an RGB triple in degrees, the shared first step of HSL and HWB. Grey is hue 0. */
function hueOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;
  if (span === 0) return 0;
  const sector =
    max === r ? ((g - b) / span) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return normaliseHue(sector * 60);
}

/**
 * sRGB to HSL.
 *
 * **Only defined inside the sRGB cube, and it does not pretend otherwise.**
 * Saturation's denominator `1 − |2L − 1|` is HSL's own and turns NEGATIVE once
 * lightness leaves 0..1, so a channel above 1 comes back with saturation of the
 * wrong sign — `toHsl(srgb(1.2, 1.1, 1.05))` is `{ h: 20, s: −60, l: 112.5 }`.
 * That answer is the arithmetic's own and is kept, because the module's records
 * carry arithmetic rather than presentation; it is exactly why `formatColour`
 * writes `hsl()` from `clampedToGamut` and never from the colour itself.
 */
export function toHsl(colour: Srgb): Hsl {
  const max = Math.max(colour.r, colour.g, colour.b);
  const min = Math.min(colour.r, colour.g, colour.b);
  const lightness = (max + min) / 2;
  const span = max - min;
  const denominator = 1 - Math.abs(2 * lightness - 1);
  const saturation = span === 0 || denominator === 0 ? 0 : span / denominator;
  return {
    h: hueOf(colour.r, colour.g, colour.b),
    s: saturation * 100,
    l: lightness * 100,
    alpha: colour.alpha,
  };
}

/** HSL back to sRGB. */
export function fromHsl(hsl: Hsl): Srgb {
  const h = normaliseHue(hsl.h);
  const s = hsl.s / 100;
  const l = hsl.l / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const base = l - chroma / 2;
  const sector = Math.floor(h / 60) % 6;
  const rgb: Vec3 =
    sector === 0
      ? [chroma, x, 0]
      : sector === 1
        ? [x, chroma, 0]
        : sector === 2
          ? [0, chroma, x]
          : sector === 3
            ? [0, x, chroma]
            : sector === 4
              ? [x, 0, chroma]
              : [chroma, 0, x];
  return srgb(rgb[0] + base, rgb[1] + base, rgb[2] + base, hsl.alpha);
}

/**
 * sRGB to HWB. Whiteness and blackness leave 0..100 for a colour outside the
 * cube — a channel above 1 makes blackness negative — and are kept there for
 * the same reason `toHsl`'s saturation is.
 */
export function toHwb(colour: Srgb): Hwb {
  return {
    h: hueOf(colour.r, colour.g, colour.b),
    w: Math.min(colour.r, colour.g, colour.b) * 100,
    b: (1 - Math.max(colour.r, colour.g, colour.b)) * 100,
    alpha: colour.alpha,
  };
}

/**
 * HWB back to sRGB.
 *
 * Whiteness and blackness summing to 100% or more is not an error — CSS defines
 * it as the grey `w / (w + b)`, and refusing it would reject a form the
 * language explicitly gives a meaning to.
 */
export function fromHwb(hwb: Hwb): Srgb {
  const w = hwb.w / 100;
  const b = hwb.b / 100;
  if (w + b >= 1) {
    const grey = w / (w + b);
    return srgb(grey, grey, grey, hwb.alpha);
  }
  const pure = fromHsl({ h: hwb.h, s: 100, l: 50, alpha: 1 });
  const scale = 1 - w - b;
  return srgb(pure.r * scale + w, pure.g * scale + w, pure.b * scale + w, hwb.alpha);
}

/* -------------------------------------------------------------------------- */
/* The named colours                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The CSS named colours, `name hex` pairs — CSS Color 4 §6.1, all 148 of them
 * (the X11 inheritance plus `rebeccapurple`). Written as one packed literal
 * rather than 148 object lines because it is DATA: a reviewer checks it by
 * reading pairs, and `NAMED_COLOUR_COUNT` catches a dropped one.
 *
 * The duplicate spellings are deliberate and are in the specification: `aqua`
 * and `cyan`, `fuchsia` and `magenta`, and every `gray`/`grey` pair name the
 * same bytes.
 */
const NAMED_COLOUR_TABLE = `
  aliceblue f0f8ff  antiquewhite faebd7  aqua 00ffff  aquamarine 7fffd4
  azure f0ffff  beige f5f5dc  bisque ffe4c4  black 000000
  blanchedalmond ffebcd  blue 0000ff  blueviolet 8a2be2  brown a52a2a
  burlywood deb887  cadetblue 5f9ea0  chartreuse 7fff00  chocolate d2691e
  coral ff7f50  cornflowerblue 6495ed  cornsilk fff8dc  crimson dc143c
  cyan 00ffff  darkblue 00008b  darkcyan 008b8b  darkgoldenrod b8860b
  darkgray a9a9a9  darkgreen 006400  darkgrey a9a9a9  darkkhaki bdb76b
  darkmagenta 8b008b  darkolivegreen 556b2f  darkorange ff8c00  darkorchid 9932cc
  darkred 8b0000  darksalmon e9967a  darkseagreen 8fbc8f  darkslateblue 483d8b
  darkslategray 2f4f4f  darkslategrey 2f4f4f  darkturquoise 00ced1  darkviolet 9400d3
  deeppink ff1493  deepskyblue 00bfff  dimgray 696969  dimgrey 696969
  dodgerblue 1e90ff  firebrick b22222  floralwhite fffaf0  forestgreen 228b22
  fuchsia ff00ff  gainsboro dcdcdc  ghostwhite f8f8ff  gold ffd700
  goldenrod daa520  gray 808080  green 008000  greenyellow adff2f
  grey 808080  honeydew f0fff0  hotpink ff69b4  indianred cd5c5c
  indigo 4b0082  ivory fffff0  khaki f0e68c  lavender e6e6fa
  lavenderblush fff0f5  lawngreen 7cfc00  lemonchiffon fffacd  lightblue add8e6
  lightcoral f08080  lightcyan e0ffff  lightgoldenrodyellow fafad2  lightgray d3d3d3
  lightgreen 90ee90  lightgrey d3d3d3  lightpink ffb6c1  lightsalmon ffa07a
  lightseagreen 20b2aa  lightskyblue 87cefa  lightslategray 778899  lightslategrey 778899
  lightsteelblue b0c4de  lightyellow ffffe0  lime 00ff00  limegreen 32cd32
  linen faf0e6  magenta ff00ff  maroon 800000  mediumaquamarine 66cdaa
  mediumblue 0000cd  mediumorchid ba55d3  mediumpurple 9370db  mediumseagreen 3cb371
  mediumslateblue 7b68ee  mediumspringgreen 00fa9a  mediumturquoise 48d1cc  mediumvioletred c71585
  midnightblue 191970  mintcream f5fffa  mistyrose ffe4e1  moccasin ffe4b5
  navajowhite ffdead  navy 000080  oldlace fdf5e6  olive 808000
  olivedrab 6b8e23  orange ffa500  orangered ff4500  orchid da70d6
  palegoldenrod eee8aa  palegreen 98fb98  paleturquoise afeeee  palevioletred db7093
  papayawhip ffefd5  peachpuff ffdab9  peru cd853f  pink ffc0cb
  plum dda0dd  powderblue b0e0e6  purple 800080  rebeccapurple 663399
  red ff0000  rosybrown bc8f8f  royalblue 4169e1  saddlebrown 8b4513
  salmon fa8072  sandybrown f4a460  seagreen 2e8b57  seashell fff5ee
  sienna a0522d  silver c0c0c0  skyblue 87ceeb  slateblue 6a5acd
  slategray 708090  slategrey 708090  snow fffafa  springgreen 00ff7f
  steelblue 4682b4  tan d2b48c  teal 008080  thistle d8bfd8
  tomato ff6347  turquoise 40e0d0  violet ee82ee  wheat f5deb3
  white ffffff  whitesmoke f5f5f5  yellow ffff00  yellowgreen 9acd32
`;

/**
 * Parses the packed table once. Throws on a malformed pair, which is the one
 * kind of throw this module allows: a broken literal HERE is a bug in this
 * file, not input a user can produce, and a table that silently loses a row
 * would make `colourName` answer `null` for a colour that has a name.
 */
function readNamedColours(): ReadonlyMap<string, string> {
  const words = NAMED_COLOUR_TABLE.trim().split(/\s+/);
  if (words.length % 2 !== 0) throw new Error("named colour table has a dangling word");
  const table = new Map<string, string>();
  for (let i = 0; i < words.length; i += 2) {
    const name = words[i];
    const hex = words[i + 1];
    if (name === undefined || hex === undefined) throw new Error("named colour table is ragged");
    if (!/^[a-z]+$/.test(name) || !/^[0-9a-f]{6}$/.test(hex)) {
      throw new Error(`named colour table has a malformed pair: ${name} ${hex}`);
    }
    if (table.has(name)) throw new Error(`named colour table repeats ${name}`);
    table.set(name, `#${hex}`);
  }
  return table;
}

const NAMED_COLOURS = readNamedColours();

/** How many CSS named colours there are. A test asserts this against the parsed table. */
export const NAMED_COLOUR_COUNT = 148;

/** Every CSS colour name, alphabetically — the order the table is written in. */
export function namedColourNames(): readonly string[] {
  return [...NAMED_COLOURS.keys()];
}

/**
 * Hex to name, for the reverse lookup the converter shows.
 *
 * Where two names share bytes the FIRST in alphabetical order wins, so
 * `#00ffff` reports `aqua` rather than `cyan` and `#808080` reports `gray`
 * rather than `grey`. There is no right answer, and picking the stable one
 * beats picking whichever the Map happened to end on.
 */
const NAMES_BY_HEX = ((): ReadonlyMap<string, string> => {
  const table = new Map<string, string>();
  for (const [name, hex] of NAMED_COLOURS) if (!table.has(hex)) table.set(hex, name);
  return table;
})();

/* -------------------------------------------------------------------------- */
/* Tool 1 — parsing                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A CSS `<number>`, dot decimal and optional exponent. Never a comma: that is a
 * separator here.
 *
 * **The fractional dot must be followed by a digit.** CSS Syntax 3 §4.3.12
 * consumes the `.` only when the next code point is a digit, so `1.` tokenises
 * as the number 1 followed by a delim token and `1.e2` as 1, a delim and an
 * ident — both make the declaration containing them invalid, and this file used
 * to read them as 1 and 100. A leading dot is a different matter and stays
 * legal: it is the digits BEFORE the dot that are optional, never the ones
 * after it.
 *
 * Written once and interpolated into the three grammars below, because a
 * grammar kept in three copies is a grammar that gets corrected in one.
 */
const CSS_NUMBER_SOURCE = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?`;

const CSS_NUMBER = new RegExp(`^${CSS_NUMBER_SOURCE}$`, "i");
const CSS_PERCENTAGE = new RegExp(`^(${CSS_NUMBER_SOURCE})%$`, "i");
const CSS_ANGLE = new RegExp(`^(${CSS_NUMBER_SOURCE})(deg|grad|rad|turn)?$`, "i");
const CSS_HEX = /^#([0-9a-f]+)$/i;
const CSS_FUNCTION = /^([a-z]+)\(([^()]*)\)$/;

function cssNumber(text: string): number | null {
  return CSS_NUMBER.test(text) ? Number(text) : null;
}

function cssPercentage(text: string): number | null {
  const match = CSS_PERCENTAGE.exec(text);
  return match === null ? null : Number(match[1]);
}

/** A component written either as a number or as a percentage of `full` — CSS Color 4 allows both, per component. */
function numberOrPercentage(text: string, full: number): number | null {
  const percentage = cssPercentage(text);
  if (percentage !== null) return (percentage / 100) * full;
  return cssNumber(text);
}

/** `<angle>` or a bare number meaning degrees. */
function cssAngle(text: string): number | null {
  const match = CSS_ANGLE.exec(text);
  if (match === null) return null;
  const value = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  if (unit === undefined || unit === "deg") return value;
  if (unit === "grad") return value * 0.9;
  if (unit === "rad") return (value * 180) / Math.PI;
  return value * 360;
}

/** Alpha, clamped to 0..1 because CSS clamps it — see the module comment on clamping. */
function cssAlpha(text: string): number | null {
  const value = numberOrPercentage(text, 1);
  if (value === null || !Number.isFinite(value)) return null;
  return clamp01(value);
}

interface FunctionForm {
  readonly name: string;
  readonly components: Vec3Text;
  readonly alpha: string | undefined;
  /** The comma form (`rgb(1, 2, 3)`), which only the legacy functions accept. */
  readonly legacy: boolean;
}

type Vec3Text = readonly [string, string, string];

/**
 * Splits `name(...)` into three components and an optional alpha.
 *
 * The comma and the space forms are decided by ONE test — does the body contain
 * a comma — rather than by trying both. Mixing them (`rgb(255, 0 0)`) is
 * invalid CSS and comes out of this as a refusal, which is the point: a parser
 * that tolerated the mix would accept text no browser does.
 */
function splitFunction(text: string): FunctionForm | null {
  const match = CSS_FUNCTION.exec(text);
  if (match === null) return null;
  const name = match[1] ?? "";
  const body = match[2] ?? "";

  if (body.includes(",")) {
    const parts = body.split(",").map((part) => part.trim());
    if (parts.length !== 3 && parts.length !== 4) return null;
    if (parts.some((part) => part === "" || /\s/.test(part))) return null;
    const [first, second, third, alpha] = parts;
    if (first === undefined || second === undefined || third === undefined) return null;
    return { name, components: [first, second, third], alpha, legacy: true };
  }

  const halves = body.split("/");
  if (halves.length > 2) return null;
  const main = (halves[0] ?? "").trim().split(/\s+/).filter((part) => part !== "");
  if (main.length !== 3) return null;
  const [first, second, third] = main;
  if (first === undefined || second === undefined || third === undefined) return null;
  if (halves.length === 1) {
    return { name, components: [first, second, third], alpha: undefined, legacy: false };
  }
  const alpha = (halves[1] ?? "").trim();
  if (alpha === "" || /\s/.test(alpha)) return null;
  return { name, components: [first, second, third], alpha, legacy: false };
}

function parseRgbFunction(form: FunctionForm, alpha: number): Srgb | null {
  const channels = form.components.map((part) => {
    const value = numberOrPercentage(part, 255);
    return value === null || !Number.isFinite(value) ? null : clamp(value, 0, 255) / 255;
  });
  const [r, g, b] = channels;
  if (r === null || g === null || b === null) return null;
  if (r === undefined || g === undefined || b === undefined) return null;
  return srgb(r, g, b, alpha);
}

function parseHslFunction(form: FunctionForm, alpha: number): Srgb | null {
  const h = cssAngle(form.components[0]);
  const s = numberOrPercentage(form.components[1], 100);
  const l = numberOrPercentage(form.components[2], 100);
  if (h === null || s === null || l === null) return null;
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) return null;
  return fromHsl({ h, s: clamp(s, 0, 100), l: clamp(l, 0, 100), alpha });
}

function parseHwbFunction(form: FunctionForm, alpha: number): Srgb | null {
  const h = cssAngle(form.components[0]);
  const w = numberOrPercentage(form.components[1], 100);
  const b = numberOrPercentage(form.components[2], 100);
  if (h === null || w === null || b === null) return null;
  if (!Number.isFinite(h) || !Number.isFinite(w) || !Number.isFinite(b)) return null;
  return fromHwb({ h, w: clamp(w, 0, 100), b: clamp(b, 0, 100), alpha });
}

/** The percentage reference values CSS Color 4 fixes for the Lab family. */
const LAB_AB_FULL = 125;
const LCH_CHROMA_FULL = 150;
const OKLAB_AB_FULL = 0.4;
const OKLCH_CHROMA_FULL = 0.4;

/**
 * The top of each lightness axis — 100 for CSS's `lab()`/`lch()`, 1 for the ok-
 * pair. It is both the value 100% refers to and the value CSS clamps lightness
 * to, which is why the parser below and `formatColour` read it from here rather
 * than from a literal each: a formatter clamping anywhere other than where the
 * parser clamps emits a string that does not re-read as itself.
 */
const LAB_LIGHTNESS_FULL = 100;
const OKLAB_LIGHTNESS_FULL = 1;

function parseLabFamily(form: FunctionForm, alpha: number): Srgb | null {
  const isOk = form.name.startsWith("ok");
  const polar = form.name.endsWith("lch");
  const lightnessFull = isOk ? OKLAB_LIGHTNESS_FULL : LAB_LIGHTNESS_FULL;
  const first = numberOrPercentage(form.components[0], lightnessFull);
  if (first === null || !Number.isFinite(first)) return null;
  const l = clamp(first, 0, lightnessFull);

  if (polar) {
    const chromaFull = isOk ? OKLCH_CHROMA_FULL : LCH_CHROMA_FULL;
    const c = numberOrPercentage(form.components[1], chromaFull);
    const h = cssAngle(form.components[2]);
    if (c === null || h === null || !Number.isFinite(c) || !Number.isFinite(h)) return null;
    const chroma = Math.max(c, 0);
    return isOk
      ? fromOklch({ l, c: chroma, h, alpha })
      : fromLch({ l, c: chroma, h, alpha });
  }

  const abFull = isOk ? OKLAB_AB_FULL : LAB_AB_FULL;
  const a = numberOrPercentage(form.components[1], abFull);
  const b = numberOrPercentage(form.components[2], abFull);
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  return isOk ? fromOklab({ l, a, b, alpha }) : fromLab({ l, a, b, alpha });
}

/** The functions that still accept the comma form. Everything newer is space-syntax only. */
const LEGACY_FUNCTIONS: ReadonlySet<string> = new Set(["rgb", "rgba", "hsl", "hsla"]);

function isPercentage(text: string): boolean {
  return CSS_PERCENTAGE.test(text);
}

/**
 * Whether a comma-form colour's components match the legacy grammar CSS Color 4
 * §8.1 actually writes down.
 *
 * `<legacy-rgb-syntax>` is `rgb(<percentage>#{3}, …)` OR `rgb(<number>#{3}, …)`
 * — two alternatives, with no third that mixes them — so `rgb(100%, 0, 0)` is
 * invalid however reasonable it looks. Mixing is legal only in the MODERN
 * space-separated form, where each component is spelled `<number> | <percentage>`
 * on its own; `splitFunction` already knows which form it read, and this is the
 * downstream half of that knowledge, which was missing.
 * `<legacy-hsl-syntax>` fixes saturation and lightness as `<percentage>`, so
 * `hsl(120, 50, 50)` is invalid for the same reason: the bare number there is
 * modern-syntax-only.
 *
 * Hue is deliberately not tested here. `cssAngle` refuses a percentage, which
 * is right in both syntaxes — `hsl(50%, 100%, 50%)` is not a colour in either.
 */
function legacyComponentsMatchTheirGrammar(form: FunctionForm): boolean {
  if (form.name === "hsl" || form.name === "hsla") {
    return isPercentage(form.components[1]) && isPercentage(form.components[2]);
  }
  const percentages = form.components.filter(isPercentage).length;
  return percentages === 0 || percentages === 3;
}

function parseHex(text: string): Srgb | null {
  const match = CSS_HEX.exec(text);
  if (match === null) return null;
  const digits = (match[1] ?? "").toLowerCase();
  const short = digits.length === 3 || digits.length === 4;
  if (!short && digits.length !== 6 && digits.length !== 8) return null;
  const step = short ? 1 : 2;
  const channel = (index: number): number => {
    const slice = digits.slice(index * step, index * step + step);
    return parseInt(short ? `${slice}${slice}` : slice, 16) / 255;
  };
  const hasAlpha = digits.length === 4 || digits.length === 8;
  return srgb(channel(0), channel(1), channel(2), hasAlpha ? channel(3) : 1);
}

/**
 * A CSS colour, or `null` for text this tool does not admit.
 *
 * Case-folded and trimmed first: CSS keywords and hex digits are
 * case-insensitive, and `#FFF` and `#fff` are the same colour to every browser.
 * Whitespace INSIDE a function is significant to the space syntax, so only the
 * outer edges are trimmed.
 */
export function parseColour(text: string): Srgb | null {
  const normalised = text.trim().toLowerCase();
  if (normalised === "") return null;

  // `transparent` is a CSS-wide keyword, not one of the 148 names; it is the
  // one keyword worth admitting because it is the only way to say „no colour"
  // that has a defined value.
  if (normalised === "transparent") return srgb(0, 0, 0, 0);

  const named = NAMED_COLOURS.get(normalised);
  if (named !== undefined) return parseHex(named);

  if (normalised.startsWith("#")) return parseHex(normalised);

  const form = splitFunction(normalised);
  if (form === null) return null;
  if (form.legacy && !LEGACY_FUNCTIONS.has(form.name)) return null;
  if (form.legacy && !legacyComponentsMatchTheirGrammar(form)) return null;
  // `none` carries „this component is missing" through CSS interpolation. This
  // tool has no missing-component concept, and substituting 0 would be wrong at
  // every gradient midpoint, so the whole colour is refused instead.
  if (form.components.some((part) => part === "none")) return null;
  if (form.alpha === "none") return null;

  const alpha = form.alpha === undefined ? 1 : cssAlpha(form.alpha);
  if (alpha === null) return null;

  switch (form.name) {
    case "rgb":
    case "rgba":
      return parseRgbFunction(form, alpha);
    case "hsl":
    case "hsla":
      return parseHslFunction(form, alpha);
    case "hwb":
      return parseHwbFunction(form, alpha);
    case "lab":
    case "lch":
    case "oklab":
    case "oklch":
      return parseLabFamily(form, alpha);
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Tool 1 — formatting                                                         */
/* -------------------------------------------------------------------------- */

/** The syntaxes the converter can write. `named` is not one — it can fail, so it is `colourName`. */
export const COLOUR_FORMATS = ["hex", "rgb", "hsl", "hwb", "lab", "lch", "oklab", "oklch"] as const;

export type ColourFormat = (typeof COLOUR_FORMATS)[number];

/**
 * A number for a CSS string, at `decimals` places with trailing zeros dropped.
 *
 * The precisions below are not cosmetic. They are chosen so that hex → any
 * format → hex is EXACT for all 8-bit colours: three decimals on an HSL
 * percentage is 0,0013 of a channel, two decimals of hue is 0,05 of a channel
 * at full chroma, and both sit far under the half-channel that would flip a
 * rounded byte. Loosen one and the round-trip test starts failing on a handful
 * of colours in a way that looks random.
 */
function fixed(value: number, decimals: number): string {
  const rounded = Number(value.toFixed(decimals));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

const ALPHA_DECIMALS = 5;

/**
 * ` / a`, or nothing at all when the colour is opaque.
 *
 * Clamped for the same reason the components are: `Srgb.alpha` is documented as
 * 0..1 and `parseColour` guarantees it, but a hand-built record can carry
 * anything, and `rgb(255 0 0 / -0.5)` is not text any browser reads.
 *
 * Opacity is then decided on the ROUNDED value, the same rule `toHex` follows
 * for its eighth byte: an alpha of 0.999999 rounds to `1` at five decimals, and
 * ` / 1` is a suffix that says „not opaque" while carrying the number for
 * opaque.
 */
function alphaSuffix(alpha: number): string {
  const shown = fixed(clamp01(alpha), ALPHA_DECIMALS);
  return shown === "1" ? "" : ` / ${shown}`;
}

function hexByte(channel: number): string {
  return Math.round(clamp01(channel) * 255)
    .toString(16)
    .padStart(2, "0");
}

/** The byte an opaque alpha rounds to, and therefore the one that must not be written out. */
const OPAQUE_HEX_BYTE = "ff";

/**
 * The colour as sRGB can actually show it, one channel at a time.
 *
 * Four of the eight syntaxes — hex, `rgb()`, `hsl()` and `hwb()` — cannot name
 * a colour outside the cube at all, so all four are written from THIS colour
 * rather than from the raw one, and therefore cannot contradict each other.
 *
 * Clamping the CHANNELS here, rather than each syntax's components afterwards,
 * is what makes the bad string unrepresentable instead of merely repaired: for
 * a colour inside the cube, saturation, whiteness and blackness are inside
 * 0..100 BY CONSTRUCTION, and there is nothing left to clamp downstream.
 * Clamping the components instead would have kept the report contradicting
 * itself — the saturation of an out-of-gamut green pinned at 100% names a
 * different colour from the same green's clamped hex.
 */
function clampedToGamut(colour: Srgb): Srgb {
  return srgb(clamp01(colour.r), clamp01(colour.g), clamp01(colour.b), colour.alpha);
}

/**
 * `#rrggbb`, or `#rrggbbaa` when the colour is not opaque.
 *
 * This is the one formatter that must clamp — hex has no way to say
 * „out of gamut" — so a caller showing a hex for a wide-gamut colour has to
 * pair it with `isInGamut`, which is why `convertColour` returns both.
 * `hexByte` is that clamp, applied per channel: the same rule
 * `clampedToGamut` applies for the other three sRGB-bound syntaxes.
 *
 * Whether the alpha byte is written at all is decided by THE BYTE, never by the
 * alpha it came from. Every alpha from 0.99804 up rounds to `ff`, so asking the
 * raw number produced `#ff0000ff` — eight digits announcing „not opaque" whose
 * own last pair says the opposite, in a report where `rgb()` said `/ 0.999`.
 */
export function toHex(colour: Srgb): string {
  const base = `#${hexByte(colour.r)}${hexByte(colour.g)}${hexByte(colour.b)}`;
  const alpha = hexByte(colour.alpha);
  return alpha === OPAQUE_HEX_BYTE ? base : `${base}${alpha}`;
}

/** The CSS name for this exact colour, or `null` when it has none. Opaque colours only — no name carries alpha. */
export function colourName(colour: Srgb): string | null {
  if (colour.alpha < 1 || !isInGamut(colour)) return null;
  return NAMES_BY_HEX.get(toHex(colour)) ?? null;
}

/**
 * A colour written in one CSS syntax. Modern space-separated form throughout —
 * the comma form is only parsed, never emitted.
 *
 * **Every branch emits a string a browser reads back as the value written
 * here.** The four sRGB-bound syntaxes go through `clampedToGamut` and so agree
 * with each other exactly; the four that can name a colour outside sRGB are
 * written from the colour itself and clamp lightness — and only lightness —
 * exactly where `parseLabFamily` clamps it, 0..100 for `lab()`/`lch()` and
 * 0..1 for the ok- pair. Nothing else needs a bound: chroma comes off
 * `Math.hypot` and cannot be negative, hue is already folded into 0..360 by
 * `hueOf` and `toPolar`, and `a`/`b` are unbounded in CSS as they are here.
 */
export function formatColour(colour: Srgb, format: ColourFormat): string {
  const alpha = alphaSuffix(colour.alpha);
  switch (format) {
    case "hex":
      return toHex(colour);
    case "rgb": {
      const shown = clampedToGamut(colour);
      const byte = (channel: number): string => String(Math.round(channel * 255));
      return `rgb(${byte(shown.r)} ${byte(shown.g)} ${byte(shown.b)}${alpha})`;
    }
    case "hsl": {
      const hsl = toHsl(clampedToGamut(colour));
      return `hsl(${fixed(hsl.h, 2)} ${fixed(hsl.s, 3)}% ${fixed(hsl.l, 3)}%${alpha})`;
    }
    case "hwb": {
      const hwb = toHwb(clampedToGamut(colour));
      return `hwb(${fixed(hwb.h, 2)} ${fixed(hwb.w, 3)}% ${fixed(hwb.b, 3)}%${alpha})`;
    }
    case "lab": {
      const lab = toLab(colour);
      const l = clamp(lab.l, 0, LAB_LIGHTNESS_FULL);
      return `lab(${fixed(l, 3)} ${fixed(lab.a, 3)} ${fixed(lab.b, 3)}${alpha})`;
    }
    case "lch": {
      const lch = toLch(colour);
      const l = clamp(lch.l, 0, LAB_LIGHTNESS_FULL);
      return `lch(${fixed(l, 3)} ${fixed(lch.c, 3)} ${fixed(lch.h, 2)}${alpha})`;
    }
    case "oklab": {
      const oklab = toOklab(colour);
      const l = clamp(oklab.l, 0, OKLAB_LIGHTNESS_FULL);
      return `oklab(${fixed(l, 5)} ${fixed(oklab.a, 5)} ${fixed(oklab.b, 5)}${alpha})`;
    }
    case "oklch": {
      const oklch = toOklch(colour);
      const l = clamp(oklch.l, 0, OKLAB_LIGHTNESS_FULL);
      return `oklch(${fixed(l, 5)} ${fixed(oklch.c, 5)} ${fixed(oklch.h, 2)}${alpha})`;
    }
  }
}

/** Every syntax for one colour, plus whether sRGB can actually show it. The converter tool's whole answer. */
export interface ColourReport {
  readonly colour: Srgb;
  /**
   * False when a `lab()`/`oklch()` input names a colour outside sRGB. The four
   * sRGB-bound formats below are then one clamped approximation — the same one,
   * in four spellings — while `lab`, `lch`, `oklab` and `oklch` still name the
   * colour that was typed.
   */
  readonly inGamut: boolean;
  readonly formats: Readonly<Record<ColourFormat, string>>;
  readonly name: string | null;
}

/** Parse once, write every syntax. `null` only when the text is not a colour. */
export function convertColour(text: string): ColourReport | null {
  const colour = parseColour(text);
  if (colour === null) return null;
  const formats: Record<ColourFormat, string> = {
    hex: formatColour(colour, "hex"),
    rgb: formatColour(colour, "rgb"),
    hsl: formatColour(colour, "hsl"),
    hwb: formatColour(colour, "hwb"),
    lab: formatColour(colour, "lab"),
    lch: formatColour(colour, "lch"),
    oklab: formatColour(colour, "oklab"),
    oklch: formatColour(colour, "oklch"),
  };
  return { colour, inGamut: isInGamut(colour), formats, name: colourName(colour) };
}

/* -------------------------------------------------------------------------- */
/* Tool 6 — mixing (defined before the palette and gradient tools, which use it) */
/* -------------------------------------------------------------------------- */

/** The three spaces a mix can happen in. That they disagree is the tool's entire point. */
export const MIX_SPACES = ["srgb", "linear-rgb", "oklab"] as const;

export type MixSpace = (typeof MIX_SPACES)[number];

/** One colour and how much of it. Weights are relative — they need not sum to anything. */
export interface ColourPart {
  readonly colour: Srgb;
  readonly weight: number;
}

interface SpaceCodec {
  readonly to: (colour: Srgb) => Vec3;
  readonly from: (coords: Vec3, alpha: number) => Srgb;
}

const SPACE_CODECS: Readonly<Record<MixSpace, SpaceCodec>> = {
  srgb: {
    to: (colour) => [colour.r, colour.g, colour.b],
    from: (coords, alpha) => srgb(coords[0], coords[1], coords[2], alpha),
  },
  "linear-rgb": {
    to: toLinearVec,
    from: fromLinearVec,
  },
  oklab: {
    to: (colour) => linearRgbToOklab(toLinearVec(colour)),
    from: (coords, alpha) => fromLinearVec(oklabToLinearRgb(coords), alpha),
  },
};

/**
 * A weighted mix of two or more colours in one space.
 *
 * **Alpha is premultiplied before interpolation**, as CSS's `color-mix()`
 * specifies, and this is the trap the function exists to avoid: mix opaque red
 * with a fully transparent colour without premultiplying and the transparent
 * colour's meaningless RGB still drags the result — half-transparent red comes
 * out olive if the transparent partner happened to be stored as green. With
 * premultiplication a fully transparent colour contributes only alpha, which is
 * the only thing it actually carries.
 *
 * Refuses an empty list, a non-finite or negative weight, and a total weight of
 * zero — none of those has an answer, and each is a caller mistake worth
 * seeing rather than a zero to invent.
 */
export function mixColours(parts: readonly ColourPart[], space: MixSpace): Srgb | null {
  if (parts.length === 0) return null;
  let totalWeight = 0;
  for (const part of parts) {
    if (!Number.isFinite(part.weight) || part.weight < 0) return null;
    totalWeight += part.weight;
  }
  if (totalWeight <= 0) return null;

  const codec = SPACE_CODECS[space];
  let x = 0;
  let y = 0;
  let z = 0;
  let alpha = 0;
  for (const part of parts) {
    const share = part.weight / totalWeight;
    const coords = codec.to(part.colour);
    const premultiplied = share * part.colour.alpha;
    x += coords[0] * premultiplied;
    y += coords[1] * premultiplied;
    z += coords[2] * premultiplied;
    alpha += share * part.colour.alpha;
  }
  if (alpha === 0) return srgb(0, 0, 0, 0);
  return codec.from([x / alpha, y / alpha, z / alpha], clamp01(alpha));
}

/** `a` and `b` mixed at `t` (0 = all `a`, 1 = all `b`). The two-colour case of `mixColours`. */
export function mixPair(a: Srgb, b: Srgb, t: number, space: MixSpace): Srgb | null {
  if (!Number.isFinite(t) || t < 0 || t > 1) return null;
  return mixColours(
    [
      { colour: a, weight: 1 - t },
      { colour: b, weight: t },
    ],
    space,
  );
}

/**
 * `source` drawn over `backdrop` — Porter-Duff source-over.
 *
 * A SEPARATE operation from mixing, and deliberately so: a 50% mix of red and
 * blue is purple, while 50%-alpha red over blue is a different colour, and a
 * tool that offered one control for both would be teaching the confusion it
 * exists to clear up.
 *
 * Composited in gamma-encoded sRGB rather than in linear light, because that is
 * what a browser does — physically the linear answer is the correct one, but
 * this tool's job is to predict the screen, not to be right about photons.
 */
export function compositeOver(source: Srgb, backdrop: Srgb): Srgb {
  const outAlpha = source.alpha + backdrop.alpha * (1 - source.alpha);
  if (outAlpha === 0) return srgb(0, 0, 0, 0);
  const channel = (from: number, over: number): number =>
    (from * source.alpha + over * backdrop.alpha * (1 - source.alpha)) / outAlpha;
  return srgb(
    channel(source.r, backdrop.r),
    channel(source.g, backdrop.g),
    channel(source.b, backdrop.b),
    outAlpha,
  );
}

/* -------------------------------------------------------------------------- */
/* Tool 2 — palettes                                                           */
/* -------------------------------------------------------------------------- */

/** Above this a „ramp" is not a palette any more, and a mistyped step count should not build a million swatches. */
const MAX_RAMP_STEPS = 64;

/** A base colour's ramp. Neither list contains the base itself. */
export interface ColourRamp {
  /** Toward white, nearest the base first. */
  readonly tints: readonly Srgb[];
  /** Toward black, nearest the base first. */
  readonly shades: readonly Srgb[];
}

const WHITE = srgb(1, 1, 1);
const BLACK = srgb(0, 0, 0);

/**
 * `steps` tints and `steps` shades of `base`, mixed in Oklab.
 *
 * Oklab rather than sRGB because an sRGB ramp is not evenly spaced to the eye:
 * the steps bunch up at the light end and the mid-tones go chalky. In Oklab the
 * lightness axis IS the perceptual one, so a ten-step ramp reads as ten equal
 * steps.
 *
 * Refuses a step count that is not a whole number in 1..64.
 */
export function tintsAndShades(base: Srgb, steps: number): ColourRamp | null {
  if (!Number.isInteger(steps) || steps < 1 || steps > MAX_RAMP_STEPS) return null;
  const tints: Srgb[] = [];
  const shades: Srgb[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / (steps + 1);
    const tint = mixPair(base, WHITE, t, "oklab");
    const shade = mixPair(base, BLACK, t, "oklab");
    if (tint === null || shade === null) return null;
    tints.push(tint);
    shades.push(shade);
  }
  return { tints, shades };
}

/** The harmony sets the palette tool offers. */
export const HARMONY_KINDS = [
  "complementary",
  "split-complementary",
  "analogous",
  "triadic",
  "tetradic",
  "monochromatic",
] as const;

export type HarmonyKind = (typeof HARMONY_KINDS)[number];

/**
 * Hue rotations in degrees, base first. The base leads every set so a surface
 * can render „your colour, then its partners" without a special case, and so
 * `harmony(c, k)[0]` is always `c`.
 */
type RotatedHarmony = Exclude<HarmonyKind, "monochromatic">;

const HARMONY_ROTATIONS: Readonly<Record<RotatedHarmony, readonly number[]>> = {
  complementary: [0, 180],
  "split-complementary": [0, 150, 210],
  analogous: [0, 30, -30],
  triadic: [0, 120, 240],
  tetradic: [0, 90, 180, 270],
};

/** Monochromatic lightness factors, base first: two darker, then two lighter. */
const MONOCHROMATIC_STEPS: readonly number[] = [0, -0.45, -0.2, 0.25, 0.5];

/**
 * A harmony set for `base`, always with `base` at index 0.
 *
 * **Hue is rotated in OKLCH, never in HSL**, and this is the difference between
 * a palette and a mess. Equal steps of HSL hue are not equal perceptual steps:
 * the yellow-green stretch of the HSL wheel is compressed and the blue stretch
 * is stretched, so an HSL triad off a red base hands back a muddy olive and a
 * screaming blue that do not look like siblings. OKLCH hue is spaced by
 * appearance, so a 120° rotation moves the same perceived distance wherever it
 * starts.
 *
 * A grey base has no hue to rotate and every rotation returns it unchanged.
 * That is the honest answer, not a failure.
 */
export function harmony(base: Srgb, kind: HarmonyKind): readonly Srgb[] {
  const oklch = toOklch(base);
  if (kind === "monochromatic") {
    return MONOCHROMATIC_STEPS.map((step) => {
      const lightness = step < 0 ? oklch.l * (1 + step) : oklch.l + (1 - oklch.l) * step;
      return fromOklch({ ...oklch, l: clamp01(lightness) });
    });
  }
  return HARMONY_ROTATIONS[kind].map((rotation) =>
    fromOklch({ ...oklch, h: normaliseHue(oklch.h + rotation) }),
  );
}

/* -------------------------------------------------------------------------- */
/* Tool 3 — gradients                                                          */
/* -------------------------------------------------------------------------- */

export const GRADIENT_KINDS = ["linear", "radial", "conic"] as const;

export type GradientKind = (typeof GRADIENT_KINDS)[number];

/** The two spaces a gradient can be interpolated in. sRGB is CSS's default; Oklab is the reason to use this tool. */
export const GRADIENT_SPACES = ["srgb", "oklab"] as const;

export type GradientSpace = (typeof GRADIENT_SPACES)[number];

/** A stop, positioned 0..1 along the gradient. */
export interface GradientStop {
  readonly colour: Srgb;
  readonly position: number;
}

export interface GradientSpec {
  readonly kind: GradientKind;
  /** At least two, positions non-decreasing. Two stops at the same position are a hard edge, which is legal. */
  readonly stops: readonly GradientStop[];
  readonly space: GradientSpace;
  /** Degrees. `linear` reads it as CSS's `<angle>` (0 = upward); `conic` as `from <angle>`; `radial` ignores it. */
  readonly angleDeg?: number;
}

/**
 * Whether a spec can be drawn.
 *
 * Out-of-order stops are REFUSED rather than sorted. Sorting would make the
 * tool answer a question that was not asked — a person who typed the stops in
 * the wrong order wants to be told, not handed a gradient they will later fail
 * to reproduce in CSS, where the browser's own fix-up rule (clamp each stop to
 * the largest position before it) gives a different picture again.
 */
function validGradient(spec: GradientSpec): boolean {
  if (spec.stops.length < 2) return false;
  if (spec.angleDeg !== undefined && !Number.isFinite(spec.angleDeg)) return false;
  let previous = 0;
  for (const stop of spec.stops) {
    if (!Number.isFinite(stop.position) || stop.position < 0 || stop.position > 1) return false;
    if (stop.position < previous) return false;
    previous = stop.position;
  }
  return true;
}

/**
 * The colour at `t` along the gradient. `t` outside the stop range holds the
 * nearest end.
 *
 * The bracketing stop is found as the LAST one at or before `t`, which settles
 * the hard edge — two stops sharing a position — in the only way that matches
 * what a browser paints: from the edge onward, the later colour. Walking
 * forward to the first pair that contains `t` instead answers with the EARLIER
 * colour at exactly the edge, which is how the first draft of this got it
 * wrong: the comment said „belongs to the later stop" and the loop did the
 * opposite.
 *
 * Choosing the last such stop also makes the zero-length span unrepresentable
 * rather than special-cased. If `stops[j]` and `stops[j + 1]` shared a position
 * then `j` was not the last index at or before `t`, so the interpolation below
 * can never divide by zero — there is no branch guarding it because there is
 * nothing to guard.
 */
function gradientColourAt(spec: GradientSpec, t: number): Srgb | null {
  const stops = spec.stops;
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (first === undefined || last === undefined) return null;
  if (t <= first.position) return first.colour;
  if (t >= last.position) return last.colour;

  let index = 0;
  for (let i = 1; i < stops.length; i += 1) {
    const stop = stops[i];
    if (stop === undefined || stop.position > t) break;
    index = i;
  }
  const low = stops[index];
  const high = stops[index + 1];
  if (low === undefined || high === undefined) return null;
  if (low.position === t) return low.colour;
  const fraction = (t - low.position) / (high.position - low.position);
  return mixPair(low.colour, high.colour, fraction, spec.space);
}

/**
 * `count` colours evenly spaced along the gradient, endpoints included, so a
 * preview can be drawn with no browser in the room.
 *
 * `count` must be at least 2 — one sample of a gradient is a colour, not a
 * gradient — and at most 4096, which is more pixels than any preview strip.
 */
export function sampleGradient(spec: GradientSpec, count: number): readonly Srgb[] | null {
  if (!validGradient(spec)) return null;
  if (!Number.isInteger(count) || count < 2 || count > 4096) return null;
  const samples: Srgb[] = [];
  for (let i = 0; i < count; i += 1) {
    const colour = gradientColourAt(spec, i / (count - 1));
    if (colour === null) return null;
    samples.push(colour);
  }
  return samples;
}

/**
 * The CSS the spec describes, or `null` if the spec is not drawable.
 *
 * `in oklab` is emitted only when it is asked for: sRGB is CSS's default and
 * writing it out would add noise to the one line a person is going to copy.
 */
export function gradientCss(spec: GradientSpec): string | null {
  if (!validGradient(spec)) return null;
  const space = spec.space === "oklab" ? "in oklab" : "";
  const stops = spec.stops
    .map((stop) => `${toHex(stop.colour)} ${fixed(stop.position * 100, 3)}%`)
    .join(", ");

  const prelude: string[] = [];
  if (spec.kind === "linear" && spec.angleDeg !== undefined) {
    prelude.push(`${fixed(spec.angleDeg, 3)}deg`);
  }
  if (spec.kind === "conic" && spec.angleDeg !== undefined) {
    prelude.push(`from ${fixed(spec.angleDeg, 3)}deg`);
  }
  if (space !== "") prelude.push(space);

  const head = prelude.length === 0 ? "" : `${prelude.join(" ")}, `;
  return `${spec.kind}-gradient(${head}${stops})`;
}

/* -------------------------------------------------------------------------- */
/* Tool 4 — cubic-bezier easing                                                */
/* -------------------------------------------------------------------------- */

/** CSS `cubic-bezier(x1, y1, x2, y2)`. P0 is (0,0) and P3 is (1,1) by definition and are not stored. */
export interface CubicBezierEasing {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export const CSS_EASING_NAMES = ["linear", "ease", "ease-in", "ease-out", "ease-in-out"] as const;

export type CssEasingName = (typeof CSS_EASING_NAMES)[number];

/** The named easings, exactly as CSS Easing Level 1 defines them. */
export const CSS_EASINGS: Readonly<Record<CssEasingName, CubicBezierEasing>> = {
  linear: { x1: 0, y1: 0, x2: 1, y2: 1 },
  ease: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 },
  "ease-in": { x1: 0.42, y1: 0, x2: 1, y2: 1 },
  "ease-out": { x1: 0, y1: 0, x2: 0.58, y2: 1 },
  "ease-in-out": { x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
};

/**
 * Whether the control points are legal CSS.
 *
 * Only the x coordinates are constrained. y is free — `cubic-bezier(.5,-.5,.5,1.5)`
 * overshoots below 0 and above 1 and is perfectly valid, which is how every
 * „bounce" easing is written. x outside 0..1 would make the curve non-monotonic
 * in time, i.e. would ask the animation to run backwards, and CSS rejects it.
 */
export function isLegalEasing(easing: CubicBezierEasing): boolean {
  const finite = [easing.x1, easing.y1, easing.x2, easing.y2].every((value) =>
    Number.isFinite(value),
  );
  return finite && easing.x1 >= 0 && easing.x1 <= 1 && easing.x2 >= 0 && easing.x2 <= 1;
}

/** One axis of the Bézier at parameter `t`, in Horner form — the polynomial expansion of the standard basis. */
function bezierAxis(t: number, p1: number, p2: number): number {
  const c = 3 * p1;
  const b = 3 * (p2 - p1) - c;
  const a = 1 - c - b;
  return ((a * t + b) * t + c) * t;
}

/** The derivative of `bezierAxis` with respect to `t`. */
function bezierSlope(t: number, p1: number, p2: number): number {
  const c = 3 * p1;
  const b = 3 * (p2 - p1) - c;
  const a = 1 - c - b;
  return (3 * a * t + 2 * b) * t + c;
}

const NEWTON_ITERATIONS = 8;
/** Below this slope Newton's step is a division by almost nothing and throws `t` off the curve. */
const NEWTON_MIN_SLOPE = 1e-3;
const SOLVE_EPSILON = 1e-7;
const BISECTION_ITERATIONS = 64;

/**
 * The curve parameter `t` at which x(t) = `x`.
 *
 * **Two solvers, because one is not enough.** Newton-Raphson converges in three
 * or four steps for an ordinary easing and is the reason this is cheap enough
 * to call per animation frame. It also fails outright where the curve is flat —
 * `cubic-bezier(1, 0, 0, 1)` has x'(t) = 0 near t = 0.5, and Newton's
 * `t -= error / slope` there divides by almost zero and hurls `t` outside
 * 0..1, from where it does not come back. So the slope is checked first, and
 * anything Newton cannot finish falls to bisection, which cannot diverge
 * because x(t) is monotonic on a legal easing — the guarantee `isLegalEasing`
 * exists to provide.
 */
function solveForT(x: number, x1: number, x2: number): number {
  let t = x;
  for (let i = 0; i < NEWTON_ITERATIONS; i += 1) {
    const slope = bezierSlope(t, x1, x2);
    if (Math.abs(slope) < NEWTON_MIN_SLOPE) break;
    const error = bezierAxis(t, x1, x2) - x;
    if (Math.abs(error) < SOLVE_EPSILON) return t;
    t -= error / slope;
  }

  let low = 0;
  let high = 1;
  t = clamp01(x);
  for (let i = 0; i < BISECTION_ITERATIONS; i += 1) {
    const value = bezierAxis(t, x1, x2);
    if (Math.abs(value - x) < SOLVE_EPSILON) return t;
    if (value > x) high = t;
    else low = t;
    t = (low + high) / 2;
  }
  return t;
}

/**
 * The eased progress at `time`, or `null` for an illegal curve or a time
 * outside 0..1.
 *
 * The returned progress is NOT clamped: an overshooting easing legitimately
 * answers above 1 and below 0, and squashing that would delete the effect the
 * curve was written for.
 */
export function easingAt(easing: CubicBezierEasing, time: number): number | null {
  if (!isLegalEasing(easing)) return null;
  if (!Number.isFinite(time) || time < 0 || time > 1) return null;
  if (time === 0 || time === 1) return time;
  return bezierAxis(solveForT(time, easing.x1, easing.x2), easing.y1, easing.y2);
}

/** One point of a plotted easing curve. */
export interface EasingSample {
  readonly time: number;
  readonly progress: number;
}

/** `count` evenly spaced points along the curve, endpoints included, for drawing it. At least 2, at most 4096. */
export function sampleEasing(
  easing: CubicBezierEasing,
  count: number,
): readonly EasingSample[] | null {
  if (!isLegalEasing(easing)) return null;
  if (!Number.isInteger(count) || count < 2 || count > 4096) return null;
  const samples: EasingSample[] = [];
  for (let i = 0; i < count; i += 1) {
    const time = i / (count - 1);
    const progress = easingAt(easing, time);
    if (progress === null) return null;
    samples.push({ time, progress });
  }
  return samples;
}

/* -------------------------------------------------------------------------- */
/* Tool 5 — contrast                                                           */
/* -------------------------------------------------------------------------- */

/**
 * WCAG 2.1's own transfer constants — the 0.03928 knee, NOT sRGB's 0.04045.
 *
 * The two differ in the fourth decimal and the difference is meaningless
 * optically, but it is not meaningless politically: an auditor's checker
 * implements WCAG's text, so a tool that used the „more correct" sRGB knee
 * would disagree with the report the user is being held to. This mirrors
 * `scripts/check-contrast.mjs` exactly, constant for constant — see the note in
 * the module comment about that duplication.
 */
const WCAG_KNEE = 0.03928;
const WCAG_SLOPE = 12.92;
const WCAG_EXPONENT = 2.4;
const WCAG_OFFSET = 0.055;
const WCAG_COEFFICIENTS: Vec3 = [0.2126, 0.7152, 0.0722];

/** WCAG AA floor for body-sized text. */
export const WCAG_AA_BODY = 4.5;
/** WCAG AA floor for large text — 18pt, or 14pt bold. */
export const WCAG_AA_LARGE = 3;
/** WCAG AAA floor for body-sized text. */
export const WCAG_AAA_BODY = 7;
/** WCAG AAA floor for large text. */
export const WCAG_AAA_LARGE = 4.5;
/** WCAG AA floor for a non-text mark — an icon, a rule, a chart gridline. */
export const WCAG_AA_NON_TEXT = 3;

/**
 * WCAG 2.1 relative luminance.
 *
 * Clamps to the sRGB cube first: a colour outside the gamut has no WCAG
 * luminance, because WCAG is defined over 8-bit sRGB and nothing else. Reading
 * one anyway would produce a ratio that no display can realise.
 */
export function relativeLuminance(colour: Srgb): number {
  const channel = (value: number): number => {
    const c = clamp01(value);
    if (c <= WCAG_KNEE) return c / WCAG_SLOPE;
    return ((c + WCAG_OFFSET) / (1 + WCAG_OFFSET)) ** WCAG_EXPONENT;
  };
  return (
    WCAG_COEFFICIENTS[0] * channel(colour.r) +
    WCAG_COEFFICIENTS[1] * channel(colour.g) +
    WCAG_COEFFICIENTS[2] * channel(colour.b)
  );
}

/**
 * WCAG 2.1 contrast ratio, 1..21. Order-independent.
 *
 * Alpha is IGNORED, and deliberately: WCAG has no notion of a translucent
 * foreground, and there is no correct ratio for one until it is composited over
 * something. A caller with a translucent colour composites it with
 * `compositeOver` first — that is the tool telling the truth about what the
 * algorithm can answer, rather than inventing a number.
 */
export function contrastRatio(a: Srgb, b: Srgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * APCA (Accessible Perceptual Contrast Algorithm) constants — the APCA-W3
 * 0.1.9 revision, which is the version the WCAG 3 working draft references.
 *
 * The luminance coefficients here are the FULL-precision sRGB ones, not WCAG's
 * rounded triple above, and the transfer function is a plain 2.4 power with no
 * knee at all. Both differences are APCA's, on purpose — mixing the two sets is
 * the obvious way to get a number that is neither algorithm.
 */
const APCA_TRC = 2.4;
const APCA_COEFFICIENTS: Vec3 = [0.2126729, 0.7151522, 0.072175];
const APCA_BLACK_THRESHOLD = 0.022;
const APCA_BLACK_CLAMP = 1.414;
const APCA_NORM_BG = 0.56;
const APCA_NORM_TEXT = 0.57;
const APCA_REVERSE_TEXT = 0.62;
const APCA_REVERSE_BG = 0.65;
const APCA_SCALE = 1.14;
const APCA_LOW_OFFSET = 0.027;
const APCA_LOW_CLIP = 0.1;
const APCA_DELTA_Y_MIN = 0.0005;

function apcaLuminance(colour: Srgb): number {
  const channel = (value: number): number => clamp01(value) ** APCA_TRC;
  const y =
    APCA_COEFFICIENTS[0] * channel(colour.r) +
    APCA_COEFFICIENTS[1] * channel(colour.g) +
    APCA_COEFFICIENTS[2] * channel(colour.b);
  // APCA's soft black clamp: below the threshold, luminance is lifted rather
  // than used raw, because sRGB's own black is not the eye's black and the
  // unlifted value makes near-black pairs score far higher than they read.
  return y >= APCA_BLACK_THRESHOLD ? y : y + (APCA_BLACK_THRESHOLD - y) ** APCA_BLACK_CLAMP;
}

/**
 * APCA lightness contrast, roughly −108..106.
 *
 * **Signed, and the sign is information**: positive is dark text on a light
 * background, negative is light text on a dark one, and the two polarities are
 * scored by different exponents because the eye does not treat them
 * symmetrically. That asymmetry is the whole reason this sits beside the WCAG
 * ratio rather than replacing the need for it — WCAG 2 is order-independent and
 * therefore systematically over-rates light-on-dark, which is most of this
 * app's Noć theme. A contrast tool that reported only WCAG would be giving
 * confidently wrong advice on half the surfaces it is asked about.
 *
 * Returns 0 for a pair too close to distinguish, which is APCA's own answer
 * rather than a refusal — 0 IS the contrast.
 */
export function apcaLc(text: Srgb, background: Srgb): number {
  const yText = apcaLuminance(text);
  const yBackground = apcaLuminance(background);
  if (Math.abs(yBackground - yText) < APCA_DELTA_Y_MIN) return 0;

  if (yBackground > yText) {
    const sapc = (yBackground ** APCA_NORM_BG - yText ** APCA_NORM_TEXT) * APCA_SCALE;
    return (sapc < APCA_LOW_CLIP ? 0 : sapc - APCA_LOW_OFFSET) * 100;
  }
  const sapc = (yBackground ** APCA_REVERSE_BG - yText ** APCA_REVERSE_TEXT) * APCA_SCALE;
  return (sapc > -APCA_LOW_CLIP ? 0 : sapc + APCA_LOW_OFFSET) * 100;
}

/** Both algorithms' verdicts on one text/background pair. */
export interface ContrastReport {
  /** WCAG 2.1, 1..21. */
  readonly ratio: number;
  readonly aaBody: boolean;
  readonly aaLarge: boolean;
  readonly aaaBody: boolean;
  readonly aaaLarge: boolean;
  /** The AA floor for icons, rules and other non-text marks. */
  readonly nonText: boolean;
  /** APCA Lc, signed. Negative means light text on a dark background. */
  readonly apcaLc: number;
}

/** The contrast tool's whole answer for one pair. */
export function contrastReport(text: Srgb, background: Srgb): ContrastReport {
  const ratio = contrastRatio(text, background);
  return {
    ratio,
    aaBody: ratio >= WCAG_AA_BODY,
    aaLarge: ratio >= WCAG_AA_LARGE,
    aaaBody: ratio >= WCAG_AAA_BODY,
    aaaLarge: ratio >= WCAG_AAA_LARGE,
    nonText: ratio >= WCAG_AA_NON_TEXT,
    apcaLc: apcaLc(text, background),
  };
}
