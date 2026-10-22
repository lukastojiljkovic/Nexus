import { franc } from "franc";

import { NLLB_LANGUAGES, type NllbLanguage } from "../../shared/languages.js";

/** Less text than this is too little for franc to decide on, and the page makes no guess at all. */
export const DETECT_MIN_LENGTH = 10;

/** The franc codes whose ISO 639-3 code differs from the NLLB row's, each with the reason it differs. */
const FRANC_TO_ISO3: Readonly<Record<string, string>> = {
  // Mandarin: franc says `cmn`; NLLB files Chinese under `zho`, and the table has a row per script.
  cmn: "zho",
  // Estonian: franc's code is the older `ekk`; NLLB uses `est`.
  ekk: "est",
  // Standard Malay: franc says `zlm`; NLLB has `zsm`.
  zlm: "zsm",
};

const ISO3_TO_FRANC: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(FRANC_TO_ISO3).map(([code, iso3]) => [iso3, code]),
);

/**
 * The codes franc is asked to choose from: the franc code of every ISO 639-3 the
 * table names. A code franc does not know is ignored by it, so this is the set
 * of franc codes that map to a row, whether or not franc carries each one.
 */
const FRANC_ONLY = [...new Set(NLLB_LANGUAGES.map((row) => ISO3_TO_FRANC[row.iso3] ?? row.iso3))];

/** How many letters of `text` are written in `script`, read with the script's Unicode property. */
function lettersIn(text: string, script: string): number {
  return text.match(new RegExp(`\\p{Script=${script}}`, "gu"))?.length ?? 0;
}

/**
 * The row a franc code answers with. Where the ISO 639-3 code has several rows,
 * the one whose script the text is written in wins; Chinese is always the
 * Simplified row, the one the page reads.
 */
export function languageForFrancCode(code: string, text: string): NllbLanguage | null {
  const iso3 = FRANC_TO_ISO3[code] ?? code;
  const rows = NLLB_LANGUAGES.filter((row) => row.iso3 === iso3);
  if (rows.length <= 1) return rows[0] ?? null;
  if (iso3 === "zho") return rows.find((row) => row.script === "Hans") ?? null;
  return rows.reduce((best, row) => (lettersIn(text, row.script) > lettersIn(text, best.script) ? row : best));
}

/**
 * The table row the text is most likely written in, or `null` when the text is
 * too short or franc cannot name its language.
 */
export function detectLanguage(text: string): NllbLanguage | null {
  const code = franc(text, { only: FRANC_ONLY, minLength: DETECT_MIN_LENGTH });
  return code === "und" ? null : languageForFrancCode(code, text);
}
