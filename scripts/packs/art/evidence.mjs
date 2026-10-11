// The licence-evidence half: turning a fetched page into text, and deciding
// whether a quoted sentence is on it.
//
// WHY A QUOTE NEEDS A COMPARISON RULE AT ALL. The sentence a person reads on a
// page and the sentence in that page's markup are not the same string: a link in
// the middle of a line puts a `</a> <a>` between two words, which collapses to
// ONE space when rendered and to one space plus a stray one when naively
// stripped. Both of the Wikimedia quotes below are like that, and a rule of
// "must be a substring of the raw HTML" would have rejected two true quotes for
// a reason that has nothing to do with whether they are true.
//
// So the comparison is: collapse whitespace, remove whitespace adjacent to
// double quotes, and remove whitespace before a closing punctuation mark. It
// does not touch letters, digits or word order — a quote whose words differ by
// even one character still fails, which is the property the check exists for.

/** Everything a reader sees: tags and the contents of `script`/`style` removed. */
export function htmlToText(html) {
  return html
    // `\s*` before the `>` on the closing tag, because a browser ends a script at
    // `</script >` and at `</script foo="bar">` as readily as at `</script>`: a
    // regex that demands the bare form leaves the tag's contents in the text,
    // which is CodeQL's `bad-tag-filter` and, here, a licence quote "found" in a
    // script the reader never sees.
  // `</script` then anything up to `>`: the HTML parser ends a script element
  // at ANY end-tag-shaped `</script...>`, so a filter that insists on whitespace
  // (the `\s*` this replaced) leaves `</script foo="bar">` in the text, which is
  // CodeQL's `bad-tag-filter` and a real way for a page to keep a chunk of its
  // own markup in an evidence quotation.
  .replace(/<script[\s\S]*?<\/script[^>]*>/gi, " ")
  .replace(/<style[\s\S]*?<\/style[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    // THE `&amp;` DECODE COMES LAST, and `&nbsp;` moved above it for the same
    // reason: a replacement that produces an `&` must not be followed by one that
    // reads it, or `&amp;nbsp;` — the literal text "&nbsp;" escaped for HTML —
    // decodes twice into a space that was never on the page. (`double-escaping`.)
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&#x27;|&#39;|&#8217;|&rsquo;/gi, "'")
    .replace(/&quot;|&#8220;|&#8221;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The comparison form of a piece of prose; see the header for why each step is
 * there. Applied to BOTH sides, so the transformation can only ever remove the
 * same kinds of whitespace from each.
 */
export function normaliseQuote(text) {
  return String(text)
    .replace(/\s+/g, " ")
    .replace(/\s*"\s*/g, '"')
    .replace(/\s+([;,.!?)\]»])/g, "$1")
    .trim();
}

/** Whether `quote` appears verbatim in `pageText`, in comparison form. */
export function quotePresent(pageText, quote) {
  return normaliseQuote(pageText).includes(normaliseQuote(quote));
}
