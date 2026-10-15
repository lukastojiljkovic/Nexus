import { decodeNato, encodeNato } from "@nexus/core";
import { copy } from "./copy.js";
import { TextCodeCard } from "./TextCodeCard.js";

/**
 * NATO: the spelling alphabet as the words an operator says, one word per letter
 * and the digits as their ICAO pronunciations. The engine owns the table and the
 * transliteration; this tab only draws the two fields.
 */
export function NatoTab() {
  return (
    <TextCodeCard
      title={copy.nato.title}
      hint={copy.nato.hint}
      encode={(text) => {
        const result = encodeNato(text);
        return { code: result.spoken, transliterated: result.transliterated, unsupported: result.unsupported };
      }}
      decode={decodeNato}
    />
  );
}
