import { decodeBraille, encodeBraille } from "@nexus/core";
import { copy } from "./copy.js";
import { TextCodeCard } from "./TextCodeCard.js";

/**
 * BRAILLE: letters, digits and the space as Unicode Braille cells. The cells are
 * drawn in the monospace face the code fields use, so a line of them keeps its
 * columns; the engine owns the dot patterns and the indicators.
 */
export function BrailleTab() {
  return (
    <TextCodeCard
      title={copy.braille.title}
      hint={copy.braille.hint}
      encode={(text) => {
        const result = encodeBraille(text);
        return { code: result.cells, transliterated: result.transliterated, unsupported: result.unsupported };
      }}
      decode={decodeBraille}
    />
  );
}
