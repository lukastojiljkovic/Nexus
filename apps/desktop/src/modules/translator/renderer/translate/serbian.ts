import { transliterate } from "@nexus/core/pro/tekst";

/**
 * Serbian in Cyrillic, which is the only script NLLB reads for it. A text the
 * tool refuses (too long for it) is returned as it was, not guessed at.
 */
export function serbianToCyrillic(text: string): string {
  const result = transliterate({ text, direction: "latinToCyrillic" });
  return result.ok ? result.text : text;
}

/** Serbian in Latin, for a translation the user reads in the Latin script. */
export function serbianToLatin(text: string): string {
  const result = transliterate({ text, direction: "cyrillicToLatin" });
  return result.ok ? result.text : text;
}
