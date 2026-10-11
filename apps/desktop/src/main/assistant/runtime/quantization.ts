/**
 * The quantization a GGUF file's NAME states, read out of the name.
 *
 * A file name is the only thing a repository listing gives us before a byte is
 * downloaded, and the quantization is the fact a user chooses between: `Q4_K_M`
 * and `Q8_0` of the same model differ by a factor of two in size and by the
 * quality of every answer. So the name is parsed rather than displayed, and the
 * parser is deliberately narrow: it recognises the tokens llama.cpp's own
 * `convert_hf_to_gguf` and the quantisers in wide use write, and answers `null`
 * for anything else.
 *
 * `null` is not a failure. A file called `model.gguf` states nothing, and a
 * catalogue or a search list that invented "Q4" for it would be telling the user
 * something the file never said. The caller shows the file's own name beside the
 * empty field, which is honest and specific.
 *
 * `UD-` IS PART OF THE NAME. Unsloth's dynamic quants are `…-UD-Q4_K_XL.gguf`,
 * and the `UD-` prefix is the difference between a file whose tensor types were
 * chosen per layer and the fixed `Q4_K_XL` of nobody: two files with equal
 * quality claims and different bytes. It is kept in the answer, so two entries
 * that a user would see as different cannot be confused by this parser.
 */

/**
 * The tokens this parser knows, LONGEST FIRST.
 *
 * Longest first is the whole rule: `Q4_K_M` must be found before `Q4` and
 * `IQ2_XXS` before `IQ2`, or the parser reports a quantization that is a prefix
 * of the real one — `Q4_K_M` read as `Q4`, which is a different file that
 * frequently exists in the same repository.
 */
const QUANTIZATION_TOKENS: readonly string[] = [
  "IQ1_S",
  "IQ1_M",
  "IQ2_XXS",
  "IQ2_XS",
  "IQ2_S",
  "IQ2_M",
  "IQ3_XXS",
  "IQ3_XS",
  "IQ3_S",
  "IQ3_M",
  "IQ4_NL",
  "IQ4_XS",
  "Q2_K_XL",
  "Q2_K_S",
  "Q2_K",
  "Q3_K_XL",
  "Q3_K_S",
  "Q3_K_M",
  "Q3_K_L",
  "Q4_K_XL",
  "Q4_K_S",
  "Q4_K_M",
  "Q4_K_L",
  "Q4_K",
  "Q5_K_XL",
  "Q5_K_S",
  "Q5_K_M",
  "Q5_K",
  "Q6_K_XL",
  "Q6_K",
  "Q8_K_XL",
  "Q8_0",
  "Q8_K",
  "Q4_0",
  "Q4_1",
  "Q5_0",
  "Q5_1",
  "Q2_0",
  "MXFP4",
  "BF16",
  "F16",
  "F32",
];

/** What separates a token from the rest of the name: a dash, a dot, an underscore, or nothing. */
const BOUNDARY = "[-._]";

/**
 * The quantization `file` states in its name, upper-cased as the quantisers
 * write it, or `null` when the name states none.
 */
export function parseQuantization(file: string): string | null {
  const stem = file.replace(/\.gguf$/i, "");
  for (const token of QUANTIZATION_TOKENS) {
    // The token's own underscores are literal; only the boundaries are a class.
    const pattern = new RegExp(`(?:^|${BOUNDARY})${token}(?:$|${BOUNDARY})`, "i");
    if (!pattern.test(stem)) continue;
    // `UD-` is read only when it sits immediately before the token it modifies,
    // so a model whose NAME contains "ud" is not mistaken for a dynamic quant.
    const dynamic = new RegExp(`(?:^|${BOUNDARY})UD${BOUNDARY}${token}(?:$|${BOUNDARY})`, "i");
    return dynamic.test(stem) ? `UD-${token}` : token;
  }
  return null;
}

/**
 * The parts of a split GGUF's name — `…-00001-of-00004.gguf` — or `null` when
 * the name is not one of them.
 *
 * llama.cpp splits a model larger than a repository's per-file limit into
 * numbered parts, and Hugging Face lists each part as its own file. Every part
 * carries the same metadata, and llama.cpp loads them through the FIRST one
 * (which holds the tensor table), so a search that treated them as four models
 * would offer a user four downloads of one model — three of which cannot be
 * loaded on their own. The caller groups on the stem.
 */
export function parseSplitPart(
  file: string,
): { readonly stem: string; readonly part: number; readonly of: number } | null {
  const match = /^(.*)-(\d{5})-of-(\d{5})\.gguf$/i.exec(file);
  if (match === null) return null;
  const stem = match[1] ?? "";
  const part = Number(match[2]);
  const of = Number(match[3]);
  if (stem === "" || !Number.isSafeInteger(part) || !Number.isSafeInteger(of)) return null;
  if (part < 1 || of < 2 || part > of) return null;
  return { stem, part, of };
}
