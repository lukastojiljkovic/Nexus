/**
 * „Enkodiranje i dekodiranje" — the Serbian copy of this category's tool surfaces.
 *
 * One entry per tool id, keyed exactly as the registration in
 * `shared/modules.ts` spells it. The tool's NAME and its one-line blurb are not
 * here: those live in the `name` and `blurb` tables of `./devtools.ts`, because
 * the drawer's rail needs them before any surface is opened.
 */
export const DEVTOOLS_ENCODING_EN = {
  /**
   * Copy shared by more than one surface below: the phrase a refusal's
   * position is reported with, and the accessible name for every
   * encode/decode-shaped segmented switch (base64, URL kodiranje, HTML
   * entiteti, hexdump all have one).
   */
  common: {
    position: "at position",
    direction: "Direction",
  },

  base64: {
    input: "Input",
    output: "Result",
    encode: "Encode",
    decode: "Decode",
    alphabet: "Alphabet",
    alphabetStandard: "Standard (+/)",
    alphabetUrl: "URL-safe (-_)",
    alphabetAny: "Any",
    padded: "Pad with =",
    allowWhitespace: "Allow line breaks (MIME)",
    inputPlaceholder: "Paste text or Base64",
    errNotBase64: "Not Base64 — an illegal character or a length no byte sequence can produce.",
    errPadding: "The number of = characters does not match the length of the encoding.",
    errNonCanonical: "Non-canonical encoding — the last group carries bits that are not zero.",
    errMixedAlphabet: "The encoding mixes both alphabets (+/ and -_).",
    errNotUtf8: "The bytes are not valid UTF-8.",
  },

  "url-encode": {
    input: "Input",
    output: "Result",
    encode: "Encode",
    decode: "Decode",
    escaping: "Mode",
    escapingComponent: "URL component",
    escapingUri: "Whole URL",
    escapingForm: "Form data",
    hintComponent: "Safe as a single query value or a single path segment.",
    hintUri: "Keeps ; / ? : @ & = + $ , # — the URL structure stays intact.",
    hintForm: "A space becomes +, and a real plus becomes %2B.",
    inputPlaceholder: "Paste text or an encoded value",
    errPercentEscape: "Invalid escape — % must be followed by two hex digits.",
    errNotUtf8: "The escape sequences are valid, but the bytes are not UTF-8.",
    errLoneSurrogate: "The text contains half a surrogate pair, which is not a character.",
  },

  "url-parse": {
    input: "URL",
    inputPlaceholder: "https://example.com/path?a=1",
    href: "Normalised URL",
    scheme: "Scheme",
    username: "User",
    password: "Password",
    host: "Host",
    hostUnicode: "Host (Unicode)",
    isIdn: "IDN",
    port: "Port",
    defaultPort: "default",
    path: "Path",
    query: "Query parameters",
    queryKey: "Key",
    queryValue: "Value",
    noQuery: "No parameters",
    fragment: "Fragment",
    empty: "—",
    errNotAUrl: "This is not a URL — the scheme is missing or the notation is invalid.",
  },

  "ascii-binary-hex": {
    input: "Text",
    inputPlaceholder: "Enter text",
    decimal: "Decimal (code points)",
    hex: "Hexadecimal (bytes)",
    binary: "Binary (bytes)",
    characters: "Characters",
    perCharacter: "Per character",
    columnCharacter: "Character",
    columnCodePoint: "Code point",
    columnHex: "Hex",
    columnBinary: "Binary",
    reverseTitle: "Back to text",
    fromHex: "From hexadecimal",
    fromBinary: "From binary",
    fromDecimal: "From decimal",
    noBytes: "no UTF-8 representation",
    hintUtf8: "UTF-8: one character may be several bytes, so the bytes are grouped per character.",
    errHex: "Not a list of hex bytes — each token must have an even number of hex digits.",
    errBinary: "Not a list of binary bytes — each token must have a number of bits divisible by 8.",
    errCodePoints: "Not a list of code points — only decimal numbers are allowed.",
    errOutOfRange: "The code point is out of range or a surrogate, so it is not a character.",
    errNotUtf8: "The bytes are not valid UTF-8.",
  },

  "unicode-inspector": {
    input: "Text",
    inputPlaceholder: "Paste text to inspect",
    codePoint: "Code point",
    character: "Character",
    utf8: "UTF-8 bytes",
    utf16: "UTF-16 units",
    surrogatePair: "Surrogate pair",
    yes: "Yes",
    no: "No",
    category: "Category",
    normalisation: "Normalisation",
    changed: "changes the text",
    unchanged: "does not change the text",
    codePointCount: "Code points",
    utf16Length: "UTF-16 units",
    utf8ByteCount: "UTF-8 bytes",
    graphemeCount: "Graphemes",
    noUtf8: "no UTF-8 representation",
    hintLength: "What JavaScript calls length is a number of UTF-16 units, not a number of characters.",
    tooLong: "Input too long — at most {limit} characters.",
  },

  "html-entities": {
    input: "Input",
    output: "Result",
    escape: "Encode entities",
    unescape: "Decode entities",
    mode: "Scope",
    modeMinimal: "Minimal — the five markup characters",
    modeAggressive: "Aggressive — everything non-ASCII as a numeric entity",
    inputPlaceholder: "Paste HTML or plain text",
    reference: "Entity table",
    referenceSearch: "Search entities",
    referenceName: "Name",
    referenceCharacter: "Character",
    referenceCodePoint: "Code point",
    errUnterminated:
      "The & does not begin an entity — the semicolon is missing or the notation is incomplete.",
    errUnknown: "Unknown entity name.",
    errOutOfRange: "The numeric entity is not a Unicode character — a surrogate or out of range.",
  },

  hexdump: {
    output: "Dump",
    dump: "Create a dump",
    parse: "Read a dump",
    bytesPerLine: "Bytes per row",
    bytesPerGroup: "Bytes per group",
    textLabel: "Text",
    textPlaceholder: "Enter text to dump",
    dumpLabel: "Hex dump",
    dumpPlaceholder: "Paste a hex dump to read",
    parsedBytes: "Bytes read",
    hintGutter:
      "The ASCII column always sits between vertical bars — without them its content is indistinguishable from the data.",
    errLayout: "A whole number from 1 to {limit}.",
    errNotAHexdump: "Not a hex dump — a token that is not a hex byte.",
    errOffsetMismatch: "The offset in the row does not match the number of bytes read so far.",
    errAmbiguousGutter:
      "The ASCII column is not delimited by vertical bars, so it is indistinguishable from the data. Remove it or use a dump with bars.",
  },
} as const;
