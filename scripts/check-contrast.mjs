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
  ["textMuted", "bg", "captions on the page"],
  ["textMuted", "surface", "captions on a card"],
  ["textMuted", "surfaceAlt", "captions on a raised row"],
  ["data", "bg", "figures on the page"],
  ["data", "surface", "figures on a card"],
  ["danger", "bg", "destructive text on the page"],
  ["danger", "surface", "destructive text on a card"],
  ["success", "surface", "confirmation text on a card"],
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
  const check = (fgRole, bgRole, why, palette) => {
    const fg = palette[fgRole];
    const bg = palette[bgRole];
    if (fg === undefined || bg === undefined) return;
    checked += 1;
    const ratio = contrast(fg, bg);
    if (ratio < AA_BODY) {
      failures.push({ theme: themeName, fgRole, fg, bgRole, bg, why, ratio });
    }
  };

  for (const [fg, bg, why] of TEXT_ON_GROUND) check(fg, bg, why, semantic);
  for (const [fg, bg, why] of TINTED) check(fg, bg, why, semantic);

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
