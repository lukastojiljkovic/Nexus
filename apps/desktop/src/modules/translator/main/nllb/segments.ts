/**
 * A text cut into the sentences the model translates one at a time, and put
 * back together around their translations.
 *
 * NLLB-200 was trained on single sentences, and its generation stops at a
 * length set for one: a paragraph handed over whole comes back shortened. The
 * cut is `Intl.Segmenter`'s, because it knows the sentence ends of every script
 * the 202 languages are written in (`。`, `।`, `؟`), where a rule set written
 * for Serbian and English would not. Its sentences keep their trailing space and
 * line breaks, so a translation keeps the source's paragraphs.
 */

export interface Segmented {
  /** The whitespace before the first sentence. */
  readonly lead: string;
  /** Each sentence without its surrounding whitespace, and the whitespace that followed it. */
  readonly sentences: readonly { readonly text: string; readonly gap: string }[];
}

/** `text`, cut where its language ends a sentence. `bcp47` picks the language's rules. */
export function segmentText(text: string, bcp47: string): Segmented {
  const lead = text.slice(0, text.length - text.trimStart().length);
  const sentences: { text: string; gap: string }[] = [];
  for (const { segment } of new Intl.Segmenter(bcp47, { granularity: "sentence" }).segment(text)) {
    const core = segment.trim();
    const gap = segment.slice(segment.trimEnd().length);
    const last = sentences.at(-1);
    if (core === "") {
      // A segment of whitespace alone is the space between two others.
      if (last !== undefined) last.gap += gap;
      continue;
    }
    sentences.push({ text: core, gap });
  }
  return { lead, sentences };
}

/** The translated sentences in the source's places: `translations[i]` stands for `segmented.sentences[i]`. */
export function joinSegments(segmented: Segmented, translations: readonly string[]): string {
  return (
    segmented.lead +
    segmented.sentences.map((sentence, index) => (translations[index] ?? "") + sentence.gap).join("")
  );
}
