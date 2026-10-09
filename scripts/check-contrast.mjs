// No shebang, for the same reason `check-colours.mjs` has none: this module is
// both a CLI (`node scripts/check-contrast.mjs`) and an import target for its
// own tests, and Vite does not strip a shebang when it transforms an `.mjs`.
//
// WHY THIS GATE EXISTS. The palette in `packages/tokens` was chosen by eye and
// never verified. On 2026-08-07 that caught up with us: `paper.600` — Dan's
// `textMuted`, and therefore the colour of the single most common element in
// the product (499 captions) — sat at 4.39:1 against Dan's own background,
// under the WCAG AA floor of 4.5:1. Nothing in the repo could have noticed.
// The raw-colour grep proves every colour COMES FROM the tokens; nothing
// proved the tokens were LEGIBLE. This is that second proof.
//
// The defect class is „a value picked by eye in a file no test reads". The fix
// is not a darker hex — it is this file, which makes the class unrepresentable:
// a token that fails contrast now fails the build.
//
// SCOPE. The token JSON is the source of truth, deliberately, not the built
// CSS: this must fail before anything is generated, and it must not depend on
// build output existing. Refs (`{color.paper.600}`) are resolved the same way
// `build.mjs` resolves them.
//
// WHAT IS CHECKED. Only pairs the app ACTUALLY RENDERS — a matrix of every
// colour against every other would be noise, and noise in a gate gets muted.
// The pairs come from reading the component layer:
//   - text/textMuted on bg, surface and surfaceAlt (every page, every card);
//   - accent and accentStrong as TEXT, which is how selection is expressed
//     (`.nx-nav-item--active`, `.nx-segmented__option[aria-pressed]`);
//   - accentStrong on accentSoft, and data/danger on their own tints, which
//     is what `.nx-chip--accent`/`--data`/`--danger` paint;
//   - bg ON accent, because `.nx-button--primary` inverts;
//   - every one of the eight user-selectable accents, in both themes, in each
//     of those roles — an accent nobody on the team uses is still an accent a
//     user can pick, and it must be as legible as the default.
//
// THRESHOLDS. WCAG 2.2 AA: 4.5:1 for body text, 3:1 for large text (>=18.66px
// bold or >=24px regular). Every pair here is body-sized in at least one place
// it appears, so 4.5 is the floor for all of them; there is no large-text
// exemption to argue about, and that is on purpose.

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS = join(HERE, "..", "packages", "tokens", "tokens");

/** WCAG AA floor for body-sized text. */
export const AA_BODY = 4.5;

/**
 * WCAG AA floor for a NON-TEXT mark — an icon, a rule, a chart gridline, the
 * page-header sigil watermark. `textFaint` is the only role held to this rather
 * than to `AA_BODY`, and the distinction is deliberate rather than a discount:
 * it is the tier that exists so a mark can be present without competing with
 * prose, and holding it to the body floor would make it the same colour as
 * `textSubtle`, i.e. would delete the tier. It is a build failure to set text
 * in it; nothing here can prove that, so it is stated in the token's own
 * comment and in `styles.css` where the utility lives.
 */
export const AA_NON_TEXT = 3;

/**
 * sRGB channel to linear light. The 0.03928 knee and the 2.4 exponent are
 * WCAG 2.x's own definition, not sRGB's slightly different one — the gate has
 * to agree with the checkers an auditor would run, not with the colour theory.
 */
function channelToLinear(value8Bit) {
  const c = value8Bit / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a `#rrggbb` string. */
export function luminance(hex) {
  const h = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`not a #rrggbb colour: ${hex}`);
  const r = channelToLinear(parseInt(h.slice(0, 2), 16));
  const g = channelToLinear(parseInt(h.slice(2, 4), 16));
  const b = channelToLinear(parseInt(h.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#rrggbb` colours. Order-independent. */
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** `{color.paper.600}` -> the literal it points at, exactly as build.mjs does. */
function resolveRef(value, global) {
  if (typeof value !== "string") return value;
  const match = /^\{([^}]+)\}$/.exec(value);
  if (match === null) return value;
  let node = global;
  for (const part of match[1].split(".")) {
    node = node?.[part];
  }
  if (typeof node !== "string") throw new Error(`unresolvable token ref: ${value}`);
  return node;
}

/**
 * The pairs, as [foreground role, background role, why]. Roles are keys of a
 * theme's `semantic` block, or of one accent set. `why` is printed on failure
 * so the report names the surface a reader can go and look at, rather than
 * making them reverse-engineer which component pairs these two.
 */
const TEXT_ON_GROUND = [
  ["text", "bg", "body text on the page"],
  ["text", "surface", "body text on a card"],
  ["text", "surfaceAlt", "body text on a raised row"],
  ["text", "surfaceRaised", "body text in a popover or menu"],
  ["text", "surfaceSunken", "body text in an input well"],
  ["textMuted", "bg", "captions on the page"],
  ["textMuted", "surface", "captions on a card"],
  ["textMuted", "surfaceAlt", "captions on a raised row"],
  // The two surfaces the 2026-08-08 ramp added. A surface token no pair reads
  // is exactly the hole this gate was written for — `paper.600` was legible on
  // every ground anybody had thought to check, and illegible on the one nobody
  // had. Every new ground is enrolled here in the same commit that adds it.
  ["textMuted", "surfaceRaised", "captions in a popover or menu"],
  ["textMuted", "surfaceSunken", "placeholder text in an input well"],
  // The tier the 2026-08-08 ramp inserted. `textMuted` used to BE this value
  // and sat at APCA Lc 43 on Noć's card — below the readable-body floor — which
  // is why a sixty-row list read as „shouting or whispering, nothing between".
  // `textSubtle` now holds the old value and is enrolled here in its own right,
  // because a tier demoted from body to tertiary is still set as text.
  ["textSubtle", "bg", "tertiary labels on the page"],
  ["textSubtle", "surface", "tertiary labels on a card"],
  ["textSubtle", "surfaceAlt", "tertiary labels on a raised row"],
  ["data", "bg", "figures on the page"],
  ["data", "surface", "figures on a card"],
  ["danger", "bg", "destructive text on the page"],
  ["danger", "surface", "destructive text on a card"],
  ["success", "surface", "confirmation text on a card"],
];

/**
 * Marks, not prose — held to `AA_NON_TEXT` (3:1). Two roles qualify: the faint
 * ink tier (page-header sigil watermark, chart gridlines, disabled marks), and
 * the borders, which are the app's whole elevation model on a dark ground and
 * are therefore worth proving visible rather than assuming so.
 */
const NON_TEXT = [
  ["textFaint", "bg", "a faint mark on the page"],
  ["textFaint", "surface", "a faint mark on a card"],
  // The ELEC workbench (DEV-006). A wire is a MARK — a coloured line on a board
  // — so 3:1 against the bench it is drawn on, not the body floor. The nine are
  // enrolled INDIVIDUALLY rather than as a group, because they are nine
  // independent hand-picked values and the one nobody checked is the one that
  // vanishes: „bela" on Dan's light mat and „crna" on Noć's dark one are each a
  // colour whose obvious value is invisible on its own theme, which is exactly
  // why both are tuned rather than literal.
  ["elecWireRed", "elecCanvas", "a red jumper on the bench"],
  ["elecWireBlack", "elecCanvas", "a black jumper on the bench"],
  ["elecWireYellow", "elecCanvas", "a yellow jumper on the bench"],
  ["elecWireGreen", "elecCanvas", "a green jumper on the bench"],
  ["elecWireBlue", "elecCanvas", "a blue jumper on the bench"],
  ["elecWireWhite", "elecCanvas", "a white jumper on the bench"],
  ["elecWireOrange", "elecCanvas", "an orange jumper on the bench"],
  ["elecWireBrown", "elecCanvas", "a brown jumper on the bench"],
  ["elecWireGrey", "elecCanvas", "a grey jumper on the bench"],
  // A component's outline, against both the things it is drawn between. The
  // EDGE is what is held to 3:1 and the body deliberately is not: a part on a
  // bench is a stroked shape, so the boundary is carried by the stroke, and
  // demanding 3:1 of the fill as well would force every component to be a slab
  // of light on a dark mat — a board of white rectangles, which is not what a
  // board looks like. This is the same argument the hairline band makes below,
  // one rule further out.
  ["elecPartEdge", "elecPartBody", "a component's outline against its own body"],
  ["elecPartEdge", "elecCanvas", "a component's outline against the bench"],
  // The ring that says which jumper the keyboard is on. It is drawn BESIDE the
  // wire rather than on it (see `elecGeometry.ts`'s `wireFocusBox`), so what it
  // has to be legible against is the bench — the same measurement every jumper
  // above is held to, and for the same reason: it is a mark, not prose. The
  // accent could not stand in here, and that is why the workbench has a colour
  // of its own: the accent is chosen against the THEME's ground, which in Dan is
  // light paper, while the bench is dark in both themes — Dan's own accent gold
  // measures 3.0:1 against Dan's mat and the six darker ones between 1.8 and
  // 2.6, so a ring in the accent is invisible to most users in Dan.
  ["elecFocus", "elecCanvas", "the focus ring around a jumper on the bench"],
];

/**
 * Hairlines are checked as a BAND, not against a floor.
 *
 * WCAG 1.4.11's 3:1 applies to boundaries an interactive control depends on
 * being identified by — an input's outline — not to a separator between a card
 * and the page. Holding a hairline to 3:1 produces a drawn box; the app then
 * reads as a wireframe, which is the failure this whole pass exists to undo.
 *
 * But the opposite failure is equally real and was shipping: Dan's card edge
 * sat at 1.36 against the page, below the ratio at which an edge reads as
 * deliberate at all, so a card was indistinguishable from the ground it sat on.
 * So the invariant is a corridor. The floor says „an edge must be visible"; the
 * ceiling says „an edge must not be a wall".
 */
const HAIRLINE_BAND = { min: 1.2, max: 2.4 };
const HAIRLINES = [
  // The bench's grid is a hairline in the exact sense this band was written
  // for: it must be visible enough to be a ruler and faint enough not to be a
  // cage, and both failures are ones a value picked by eye reaches easily.
  ["elecGrid", "elecCanvas", "the workbench grid"],
  ["border", "surface", "a card's own edge"],
  ["border", "bg", "an edge against the page"],
  ["borderStrong", "surface", "an emphasised edge on a card"],
];

/** Chips paint a tint behind their own hue. */
const TINTED = [
  ["accentStrong", "accentSoft", ".nx-chip--accent"],
  ["data", "dataSoft", ".nx-chip--data"],
  ["danger", "dangerSoft", ".nx-chip--danger"],
];

/** The accent, in each role it plays, for every selectable accent. */
const ACCENT_ROLES = [
  ["accent", "bg", "active navigation on the page"],
  ["accent", "surface", "active navigation in the sidebar"],
  ["accentStrong", "bg", "pressed segmented option on the page"],
  ["accentStrong", "surface", "pressed segmented option on a card"],
  ["accentStrong", "accentSoft", "accent chip"],
];

/**
 * The auditor proper, over already-resolved colours.
 *
 * Split from the file reading so the gate's own coverage is provable: a test
 * can hand it a palette engineered to fail and assert the failure is caught.
 * Asserting only that the real palette passes would leave „the auditor checks
 * nothing at all" and „the palette is perfect" indistinguishable — which is the
 * exact failure mode that let the original defect ship.
 *
 * Returns `{ failures, checked }`; `checked` is the number of pairs examined,
 * so a test can also prove the walk did not silently narrow.
 */
export function auditPalette(themeName, semantic, accents = {}) {
  const failures = [];
  let checked = 0;
  const check = (fgRole, bgRole, why, palette, floor = AA_BODY) => {
    const fg = palette[fgRole];
    const bg = palette[bgRole];
    if (fg === undefined || bg === undefined) return;
    checked += 1;
    const ratio = contrast(fg, bg);
    if (ratio < floor) {
      failures.push({ theme: themeName, fgRole, fg, bgRole, bg, why, ratio, floor });
    }
  };

  for (const [fg, bg, why] of TEXT_ON_GROUND) check(fg, bg, why, semantic);
  for (const [fg, bg, why] of TINTED) check(fg, bg, why, semantic);
  for (const [fg, bg, why] of NON_TEXT) check(fg, bg, why, semantic, AA_NON_TEXT);

  for (const [lineRole, groundRole, why] of HAIRLINES) {
    const line = semantic[lineRole];
    const ground = semantic[groundRole];
    if (line === undefined || ground === undefined) continue;
    checked += 1;
    const ratio = contrast(line, ground);
    if (ratio < HAIRLINE_BAND.min || ratio > HAIRLINE_BAND.max) {
      failures.push({
        theme: themeName,
        fgRole: lineRole,
        fg: line,
        bgRole: groundRole,
        bg: ground,
        why: `${why} — a hairline must sit between ${HAIRLINE_BAND.min}:1 and ${HAIRLINE_BAND.max}:1`,
        ratio,
        floor: HAIRLINE_BAND.min,
      });
    }
  }

  // `.nx-button--primary` paints the accent and writes the page background on
  // top of it — the one inverted pair in the product.
  check("bg", "accent", "primary button label", semantic);

  // Each selectable accent replaces accent/accentSoft/accentStrong wholesale.
  for (const [accentName, overrides] of Object.entries(accents)) {
    const palette = { ...semantic, ...overrides };
    for (const [fg, bg, why] of ACCENT_ROLES) {
      check(fg, bg, `${why} — accent „${accentName}"`, palette);
    }
    check("bg", "accent", `primary button label — accent „${accentName}"`, palette);
  }
  return { failures, checked };
}

/** Read one theme's JSON, resolve its refs, and audit it. */
export function auditTheme(themeName) {
  const global = JSON.parse(readFileSync(join(TOKENS, "global.json"), "utf8"));
  const theme = JSON.parse(readFileSync(join(TOKENS, "themes", `${themeName}.json`), "utf8"));

  // Composite tokens (shadows, gradients) share the `semantic` block with
  // colours and are not colours — filtering to `#rrggbb` is what keeps them
  // out of the audit instead of throwing on them.
  const semantic = {};
  for (const [key, value] of Object.entries(theme.semantic)) {
    const resolved = resolveRef(value, global);
    if (typeof resolved === "string" && /^#[0-9a-fA-F]{6}$/.test(resolved)) semantic[key] = resolved;
  }
  const accents = Object.fromEntries(
    Object.entries(theme.accents ?? {}).map(([id, slots]) => [
      id,
      Object.fromEntries(Object.entries(slots).map(([slot, v]) => [slot, resolveRef(v, global)])),
    ]),
  );
  return auditPalette(themeName, semantic, accents);
}

export function auditAll() {
  return [...auditTheme("dan").failures, ...auditTheme("noc").failures];
}

// CLI. Kept at the bottom so importing the module runs no I/O beyond the
// functions the caller asks for. `pathToFileURL` rather than a hand-built
// `file://${argv[1]}`: on Windows `process.argv[1]` is `C:\…` with backslashes
// and no leading slash, so the hand-built form yields `file://C:/…` against an
// `import.meta.url` of `file:///C:/…` — the guard silently never fires and the
// gate exits 0 without checking anything, which is the worst way for a gate to
// fail. Node's own converter agrees with Node's own module URLs by definition.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = auditAll();
  if (failures.length === 0) {
    console.log("check-contrast: every token pair clears WCAG AA (4.5:1).");
    process.exit(0);
  }
  console.error(`check-contrast: ${failures.length} token pair(s) below WCAG AA (${AA_BODY}:1).\n`);
  for (const f of failures) {
    console.error(
      `  ${f.theme}  ${f.fgRole} (${f.fg}) on ${f.bgRole} (${f.bg})` +
        `  =  ${f.ratio.toFixed(2)}:1\n      ${f.why}`,
    );
  }
  console.error("\nFix the token in packages/tokens/tokens — never the gate.");
  process.exit(1);
}
