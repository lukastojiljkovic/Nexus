/**
 * „Tekst i prevod" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as `shared/modules.ts` spells the
 * registration. The tool's NAME and its one-line blurb are not here: those live
 * in the `name` and `blurb` tables of `./pro.ts`, needed before any surface is
 * opened.
 *
 * None of this pack's tools carries `life-safety` or `food-safety` risk, so
 * nothing here is bound by „print the quantity, never a verdict" — but three
 * tools are `financial` (a wrong digit or a wrong word is money), and their
 * copy stays exactly as factual as everything else: a count, never a judgement
 * of the translation itself.
 */
export const PRO_TEKST_EN = {
  "bracket-balance": {
    text: "Text",
    textHint: "Paste text. Nothing is remembered between openings of the tool.",

    results: "Result",
    maxDepth: "Greatest nesting depth",

    unclosedSection: "Unclosed openers",
    unclosedNone: "There are no unclosed openers.",
    unmatchedSection: "Extra closers",
    unmatchedNone: "There are no extra closers.",
    oddQuoteSection: "Paragraphs with an odd number of straight quotes",
    oddQuoteNone: "Every paragraph has an even number of straight \" and ' quotes.",

    colChar: "Character",
    colLine: "Line",
    colColumn: "Column",
    colOpenOnTop: "Opener on top of the stack",
    stackEmpty: "stack empty",
    colParagraph: "Paragraph",
    colStartLine: "Start line",
    colDoubleQuotes: "Number of \" characters",
    colSingleQuotes: "Number of ' characters",

    inputs: "Entered",
    formula:
      "stack: opener → push; closer → pop if it matches the top, otherwise report and leave the stack alone     „ and ' are resolved by the top of the stack; the straight quotes \" and ' are counted by parity within a paragraph",

    errorText: "The text may have at most 500000 code points.",
  },

  "glossary-check": {
    original: "Source",
    originalHint: "The source text, pasted.",
    translation: "Translation",
    translationHint: "The translated text, pasted.",
    glossary: "Glossary of terms",
    glossaryHint:
      "One pair per line, source and translation separated by a tab or a |. Nothing is remembered between openings.",
    caseSensitive: "Case-sensitive",
    wholeWord: "Match the whole word",
    wholeWordHint: "Off also catches Serbian case inflection through the term's stem.",
    on: "On",
    off: "Off",

    results: "Result",
    rowsNone: "The glossary has no valid line.",
    colSource: "Term (source)",
    colTarget: "Required translation",
    colInOriginal: "Occurrences in the source",
    colInTranslation: "Occurrences in the translation",
    colStatus: "Status",
    invalidRows: "Invalid glossary lines",
    invalidRowsNone: "none",

    statusMatch: "OK",
    statusDiffers: "MISMATCH",
    statusMissing: "MISSING",
    statusExtra: "EXTRA",
    statusAbsent: "NONE",

    inputs: "Entered",
    formula:
      "a = occurrences of the source term in the source, b = occurrences of the required translation in the translation     a=0,b=0 → NONE; a>0,b=0 → MISSING; a=0,b>0 → EXTRA; a=b → OK; a≠b → MISMATCH",

    errorOriginal: "The source may have at most 500000 code points.",
    errorTranslation: "The translation may have at most 500000 code points.",
    errorGlossary:
      "The glossary must have between 1 and 2000 lines with a pair separated by a tab or a |.",
  },

  "hidden-characters": {
    text: "Text",
    textHint: "Paste text. Nothing is remembered between openings of the tool.",
    removeInvisible: "Remove invisible characters",
    removeInvisibleHint:
      "Deletes control characters, zero-width characters and bidirectional controls. Leaves spaces and hyphens alone.",
    normalizeSpaces: "NBSP and similar spaces → ordinary space",
    normalizeSpacesHint:
      "Changes each unusual space one for one, never deletes it — deleting would join words together.",
    removeSoftHyphen: "Remove soft (conditional) hyphen",
    on: "On",
    off: "Off",

    results: "Result",
    codePointsBefore: "Code points before",
    codePointsAfter: "Code points after",
    findingsNone: "There are no invisible or control characters.",
    colKind: "Kind",
    colName: "Code point and name",
    colLine: "Line",
    colColumn: "Column",
    mixedNone: "There are no words with mixed scripts.",
    colWord: "Word",
    colScripts: "Scripts",
    cleaned: "Cleaned text",
    cleanedEmpty: "The text is empty.",

    kindControl: "control character",
    kindSpace: "a space that is not ordinary",
    kindZeroWidth: "zero-width character",
    kindSoftHyphen: "soft (conditional) hyphen",
    kindBidi: "bidirectional control",

    scriptLatin: "Latin",
    scriptCyrillic: "Cyrillic",
    scriptGreek: "Greek",
    scriptArabic: "Arabic",
    scriptHebrew: "Hebrew",
    scriptHan: "Han",
    scriptOther: "other",

    inputs: "Entered",
    formula:
      "finding = a code point from the invisible/control list; mixed script = a word whose set of scripts has ≥ 2 members (Common and Inherited are not counted)",

    errorText: "The text may have at most 500000 code points.",
  },

  "isbn-issn-check": {
    number: "Number",
    numberHint: "Digits with any hyphens and spaces, and X as a possible last digit.",
    kind: "Kind",
    kindAuto: "Detect automatically",
    kindIsbn10: "ISBN-10",
    kindIsbn13: "ISBN-13",
    kindIssn: "ISSN",
    kindIssn13: "ISSN (13-digit form, prefix 977)",
    kindIsmn: "ISMN",
    kindEan13: "EAN-13",

    results: "Result",
    recognizedKind: "Recognised kind",
    digits: "Cleaned digits",
    checkDigit: "Entered check digit",
    expectedCheckDigit: "Calculated check digit",
    matches: "Match",
    matchYes: "Matches",
    matchNo: "Does not match",
    isbn13: "Converted to ISBN-13",
    isbn10: "Converted to ISBN-10",
    issn8: "Extracted ISSN",

    inputs: "Entered",
    formula:
      "ISBN-10: Σ dᵢ×(11−i) ≡ 0 (mod 11)     ISBN-13 / ISMN / EAN-13: GS1, weights 1,3, mod 10     ISSN: weights 8..2, mod 11 — hyphens are not added",

    errorNumber:
      "The number must have 8, 10 or 13 digits (X allowed as the last digit for ISBN-10 and ISSN).",
    errorKind: "The length of the number does not match the chosen kind.",
  },

  "mojibake-repair": {
    text: "Text",
    textHint: "Paste corrupted text, for example “Å¡” or “Ä‡”.",
    writtenAs: "Written as",
    writtenAsHint: "The encoding the bytes were ACTUALLY written in.",
    readAs: "Read as",
    readAsHint: "The encoding those bytes were WRONGLY read in — that is the fault being undone.",
    selectPlaceholder: "— choose —",

    results: "Result",
    repaired: "Repaired text",
    notPossible: "Repair is not possible with this choice of encodings.",
    unmappableCount: "Characters with no byte in the “read as” encoding",
    invalidByteCount: "Bytes that do not form a valid sequence in the “written as” encoding",
    colIndex: "Index",
    colChar: "Character",
    colByte: "Byte (decimal)",
    resolvedWrittenAs: "The “written as” encoding resolved to",
    resolvedReadAs: "The “read as” encoding resolved to",
    collisions: "Bytes whose character is the same as a lower byte",

    inputs: "Entered",
    formula:
      "1) character → byte by the inverse map of the “read as” encoding     2) that byte sequence → text, decoded with the “written as” encoding",

    errorText: "The text may have at most 500000 code points.",
    errorReplacementCharacter: "The text already contains U+FFFD — those bytes are irrecoverably lost.",
    errorReadAs: "The platform does not recognise this encoding.",
    errorWrittenAs: "The platform does not recognise this encoding.",
  },

  "number-check": {
    original: "Source",
    originalHint: "The source text, pasted.",
    translation: "Translation",
    translationHint: "The translated text, pasted.",

    results: "Result",
    pairedCount: "Matched occurrences",
    onlyInOriginalCount: "Only in the source",
    onlyInTranslationCount: "Only in the translation",

    pairedSection: "Matched digit string",
    pairedNone: "There are no matched numbers.",
    onlyOriginalSection: "Only in the source (missing from the translation)",
    onlyOriginalNone: "There are no missing numbers.",
    onlyTranslationSection: "Only in the translation (extra)",
    onlyTranslationNone: "There are no extra numbers.",
    differentLengthSection: "Same digit string, different written length",
    differentLengthNone: "There are no such pairs.",

    colDigits: "Digit string",
    colFormsOriginal: "Forms found (source)",
    colFormsTranslation: "Forms found (translation)",
    colCount: "Number",

    inputs: "Entered",
    formula:
      "number = /\\d+(?:[.,␠']\\d+)*/     compared by digit string without separators     same string + different written length = a possible dropped decimal point",

    errorOriginal: "The source may have at most 500000 code points.",
    errorTranslation: "The translation may have at most 500000 code points.",
  },

  "number-to-serbian-words": {
    value: "Number",
    valueHint:
      "The decimal separator is a comma only, for example −1234.56. Up to 18 digits in the whole part, up to 6 decimals.",
    script: "Script",
    scriptLatinOpt: "Latin",
    scriptCyrillicOpt: "Cyrillic",
    thousandForm: "Form for 1000",
    thousandFormHint: "Both forms are correct — the writer chooses, not the tool.",
    thousandFormHiljadu: "thousand",
    thousandFormJednaHiljada: "one thousand",
    decimals: "Decimals",
    decimalsFraction: "As a fraction (NN/10ᵈ)",
    decimalsWords: "Written in words",
    decimalsNone: "Without decimals",
    selectPlaceholder: "— choose —",

    results: "Result",
    resultText: "Number in words",
    truncatedNote: "The decimals are truncated, not rounded.",

    inputs: "Entered",
    formula:
      "thousand/million/billion/trillion by groups of three digits, right to left; agreement: 11–14 → plural, …1 (except 11) → singular, …2–4 (except 12–14) → paucal, otherwise → plural",

    errorValue:
      "The number must be a whole number or a decimal with a comma, up to 18 digits in the whole part and up to 6 decimals.",
  },

  "reading-time": {
    text: "Text",
    textHint: "Paste text to be read aloud. Nothing is remembered between openings of the tool.",
    pace: "Pace",
    paceHint: "Words per minute — measured for this speaker, not estimated by the tool.",
    pause: "Pause between paragraphs",
    pauseHint: "In seconds. An empty field reads as 0.",
    pauseZero: "0 (empty field)",

    results: "Result",
    totalClock: "Total duration",
    words: "Total number of words",
    displayedSum: "Sum of the durations shown",
    sumNote:
      "The entry time is truncated down, the duration and total are rounded — the sum of the durations shown may therefore differ from the total by one second.",
    colParagraph: "Paragraph",
    colWords: "Words",
    colDuration: "Duration",
    colEntry: "Entry time",

    inputs: "Entered",
    formula:
      "paragraphDuration = words / pace × 60     entryTime(i+1) = entryTime(i) + paragraphDuration(i) + pause",

    errorText: "The text may have at most 500000 code points.",
    errorPace: "The pace must be greater than zero, up to 1000 words per minute.",
    errorPause: "The pause is a number of seconds from 0 to 600.",
  },

  "sentence-length": {
    text: "Text",
    textHint: "Paste text. Nothing is remembered between openings of the tool.",
    threshold: "Threshold",
    thresholdHint: "Number of words — a sentence longer than this is marked. A whole number from 1 to 200.",

    results: "Result",
    count: "Number of sentences",
    totalWords: "Total words",
    averageWords: "Average words per sentence",
    longest: "Longest sentence",
    words: "words",
    yes: "yes",
    no: "no",
    colIndex: "#",
    colWords: "Words",
    colText: "Sentence",
    colOverThreshold: "Over the threshold",

    inputs: "Entered",
    formula:
      "end of sentence: ./!/?/… followed by a space or the end of the text, and the next letter is NOT lowercase — with exceptions for a date (12. 5. 2020) and an initial (J. Jovanović)",

    errorText: "The text may have at most 500000 code points.",
    errorThreshold: "The threshold is a whole number of words from 1 to 200.",
  },

  "serbian-transliteration": {
    text: "Text",
    textHint: "Paste text. Nothing is remembered between openings of the tool.",
    direction: "Direction",
    directionCyrillicToLatin: "Cyrillic → Latin",
    directionLatinToCyrillic: "Latin → Cyrillic",
    selectPlaceholder: "— choose —",

    results: "Result",
    resultText: "Transliterated text",
    ambiguitiesNoneDirection: "This direction is unambiguous — the list is always empty.",
    ambiguitiesNoneOther: "There are no ambiguous places in this text.",
    colSequence: "String",
    colLine: "Line",
    colColumn: "Column",
    colWord: "Word",
    colReason: "Reason",
    reasonDigraph: "the digraph lj/nj/dž",
    reasonDj: "“dj” — never converted to đ",

    inputs: "Entered",
    formula:
      "Cyrillic → Latin: replacement by a table of 30 pairs, digraph case by context     Latin → Cyrillic: lj/nj/dž greedily, every match is reported; “dj” is never read as đ",

    errorText: "The text may have at most 500000 code points.",
  },

  "subtitle-audit": {
    subtitle: "Subtitle (SRT or WebVTT)",
    subtitleHint: "Paste the whole file contents. Up to 20000 blocks.",
    maxLineChars: "Maximum characters per line",
    maxLines: "Maximum lines per block",
    minDuration: "Shortest duration (ms)",
    maxDuration: "Longest duration (ms)",
    maxCps: "Maximum characters per second",
    minGap: "Smallest gap to the next (ms)",
    limitHint: "The limit is set by the client or broadcaster for this job. Neagle offers no value.",
    countTags: "Count characters inside <i> tags",
    countTagsHint: "Off removes <i> and ASS commands before counting characters.",
    on: "On",
    off: "Off",

    results: "Result",
    colDuration: "Duration (ms)",
    colMaxDurationRatio: "Duration ÷ your limit",
    colMinDurationRatio: "Your limit ÷ duration",
    colChars: "Characters",
    colCps: "Chars/s",
    colCpsRatio: "Chars/s ÷ your limit",
    colLongestLine: "Longest line",
    colLongestLineRatio: "Longest line ÷ your limit",
    colLines: "Lines",
    colLinesRatio: "Lines ÷ your limit",
    colGap: "Gap (ms)",
    colGapRatio: "Gap ÷ your limit",
    ratioNote:
      "For the shortest duration the ratio is inverted (limit ÷ duration), so a larger number always means “further from the limit”. An empty column means that limit was not entered.",

    nonPositiveDuration: "Blocks with zero or negative duration",
    outOfOrder: "Blocks out of order",
    overlapping: "Overlapping blocks (negative gap)",
    listNone: "none",

    inputs: "Entered",
    formula:
      "duration = out − in     chars/s = characters / (duration / 1000)     ratio = measured ÷ your limit",

    errorSubtitle: "The subtitle must have between 1 and 20000 valid blocks.",
    errorMaxLineChars: "Maximum characters per line is a whole number from 1 to 200.",
    errorMaxLines: "Maximum lines per block is a whole number from 1 to 10.",
    errorMinDuration: "The shortest duration is a whole number of milliseconds from 0 to 60000.",
    errorMaxDuration: "The longest duration is a whole number of milliseconds from 0 to 600000.",
    errorMaxCps: "Maximum characters per second is a number from 0 to 100.",
    errorMinGap: "The smallest gap is a whole number of milliseconds from 0 to 10000.",
  },

  "subtitle-retime": {
    subtitle: "Subtitle (SRT or WebVTT)",
    subtitleHint: "Paste the whole file contents. Up to 20000 blocks.",
    offset: "Offset",
    offsetHint: "+HH:MM:SS,mmm or a number of milliseconds, sign allowed. An empty field means 0.",
    offsetZero: "0 (empty field)",
    fromFps: "Source frames per second",
    toFps: "Target frames per second",
    fpsHint: "Empty in both fields means no rate conversion — offset only.",
    fpsNone: "— no rate conversion —",
    renumber: "Renumber the blocks",
    on: "On",
    off: "Off",

    results: "Result",
    resultText: "Changed subtitle",
    blocks: "Blocks processed",
    clamped: "Clamped to 00:00:00,000",
    endBeforeStart: "Blocks whose end is before the start",
    endBeforeStartNone: "none",

    inputs: "Entered",
    formula:
      "conversion: new = round(ms × sourceNumerator × targetDenominator / (sourceDenominator × targetNumerator))     offset: final = max(0, converted + offsetMs)",

    errorSubtitle: "The subtitle must have between 1 and 20000 valid blocks.",
    errorOffset: "The offset is HH:MM:SS,mmm or a number of milliseconds, from −86400000 to +86400000.",
    errorFromFps: "The source frames per second is not valid.",
    errorToFps: "The target frames per second is not valid.",
  },

  "translation-volume": {
    text: "Text",
    textHint: "Paste the text whose extent is being measured. Nothing is remembered between openings of the tool.",
    charsPerPage: "Characters per page",
    charsPerPageHint:
      "A number set by the client or association (often 1800 or 1500). It varies from job to job.",
    price: "Price per unit",
    priceHint:
      "The currency is not assumed and not shown. An empty field means amounts are not shown.",
    priceEmpty: "empty",
    unit: "Billing unit",
    unitPage: "Page",
    unitWord: "Word",
    unitCharacter: "Character with spaces",
    selectPlaceholder: "— choose —",

    results: "Result",
    charactersWithSpaces: "Characters with spaces",
    charactersWithLineBreaks: "Characters with spaces and line breaks",
    lineBreakNote:
      "Characters with spaces does NOT count line breaks — it is the same number MS Word shows and the invoice is compared against. The second value counts line breaks too, for comparison with the length of the paste itself.",
    charactersWithoutSpaces: "Characters without spaces",
    wordsBySpaces: "Words (separated by spaces)",
    wordsByLetters: "Words (runs of letters)",
    pagesExact: "Pages (exact)",
    pagesRoundedUp: "Pages (rounded up)",
    amountExact: "Amount at the exact extent",
    amountRoundedUp: "Amount at the rounded extent",
    noCurrencyNote: "The currency is not shown — it was not given as an input.",

    inputs: "Entered",
    formula:
      "pagesExact = charsWithSpaces / charsPerPage     pagesUp = ⌈pagesExact⌉     amount = price × (unrounded) quantity",

    errorText: "The text may have at most 500000 code points.",
    errorCharsPerPage: "Characters per page is a whole number from 100 to 20000.",
    errorPrice: "The price is a number from 0 to 100000000.",
  },

  "typography-cleanup": {
    text: "Text",
    textHint: "Paste text. Nothing is remembered between openings of the tool.",
    style: "Quote style",
    styleCurly: "„…“",
    styleGuillemets: "«…»",
    styleStraight: "\"…\" (leave straight)",
    selectPlaceholder: "— choose —",
    quotes: "Quotes",
    ellipses: "Ellipsis → …",
    dashes: "Dashes",
    spaces: "Spaces",
    nbsp: "NBSP → ordinary space",
    nbspHint: "Replaces U+00A0 with a space, independently of the “Quotes” rule.",
    on: "On",
    off: "Off",

    results: "Result",
    resultText: "Cleaned text",
    total: "Total changes",
    codePointsBefore: "Code points before",
    codePointsAfter: "Code points after",

    inputs: "Entered",
    formula:
      "order: quotes → ellipsis → dashes → spaces → NBSP     a dash of length 1 only between spaces or digits, length 2 → –, length 3 → —",

    errorText: "The text may have at most 500000 code points.",
  },

  "unwrap-paragraphs": {
    text: "Text",
    textHint:
      "Paste text broken by copying from a PDF. Nothing is remembered between openings of the tool.",
    joinHyphenated: "Reassemble words split by a hyphen",
    respectListItems: "Respect list items",
    respectListItemsHint:
      "A line starting with -, –, •, * or a number and a dot/bracket stays its own line.",
    splitOnSentenceEnd: "New paragraph after a finished sentence",
    splitOnSentenceEndHint: "For texts from which the empty lines were lost.",
    on: "On",
    off: "Off",

    results: "Result",
    resultText: "Tidied text",
    joinedLines: "Joined lines",
    joinedWords: "Reassembled words",
    paragraphs: "Paragraphs in the result",

    inputs: "Entered",
    formula:
      "in order: 1) hyphen + lowercase → reassemble the word     2) list marker → do not join     3) end of sentence → new paragraph     4) otherwise → join with a single space",

    errorText: "The text may have at most 500000 code points.",
  },

  "word-frequency": {
    text: "Text",
    textHint: "Paste text. Nothing is remembered between openings of the tool.",
    n: "Phrase length (words)",
    nHint: "A whole number from 1 to 10.",
    minCount: "Smallest number of occurrences",
    minCountHint: "Filters the display only — the denominator for the share stays full. A whole number from 1 to 1000.",
    minWordLength: "Smallest word length",
    minWordLengthHint:
      "Applies only when the phrase length is 1. Filters the display only. A whole number from 1 to 50.",
    caseSensitive: "Case-sensitive",
    on: "On",
    off: "Off",

    results: "Result",
    totalWords: "Total words",
    totalNgrams: "Total n-grams",
    distinctPhrases: "Distinct phrases",
    rowsNone: "No phrase passes the given thresholds.",
    colPhrase: "Phrase",
    colCount: "Occurrences",
    colShare: "Share",

    inputs: "Entered",
    formula:
      "share = occurrences / totalNgrams × 100     both thresholds filter the display only, not the denominator",

    errorText: "The text may have at most 500000 code points.",
    errorN: "The phrase length is a whole number from 1 to 10.",
    errorMinCount: "The smallest number of occurrences is a whole number from 1 to 1000.",
    errorMinWordLength: "The smallest word length is a whole number from 1 to 50.",
  },
} as const;
