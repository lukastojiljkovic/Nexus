/**
 * The copy of the `softver` pack — the forty-eight developer tools — composed
 * from one file per category. This is no longer the copy of a drawer: the
 * drawer is „Stručne alatke", and its chrome and shared surface words live in
 * `./pro.ts`.
 *
 * **Why this is not simply another group in `strings.sr.ts`.** Forty-eight
 * tools carry more copy than the eleven modules above them put together: field
 * labels, hints, table headings and one refusal per surface. Written inline it
 * would be a fifth of that file and would bury every other module's strings in
 * the scroll. The split is by CATEGORY, which is also how the drawer groups its
 * rail, so „where does this label live" has the same answer as „where does this
 * tool live".
 *
 * **Why the group is still called `devtools`.** Tools register with
 * `titleKey: "devtools.name.…"` and `blurbKey: "devtools.blurb.…"` — a tool
 * names a string in its own family's group, and this family did not change
 * when its neighbours arrived. Renaming it would have said the tools changed,
 * when only the room did.
 *
 * Nothing here is a second copy layer. This is one leaf of the same table —
 * `strings.sr.ts` spreads it in as `devtools`, `strings.ts` clones the whole
 * thing, and the locale switch rewrites these leaves exactly as it rewrites the
 * rest. A consumer still reads `strings.devtools.…` and never imports this file.
 */
import { DEVTOOLS_NUMBERS_EN } from "./devtools.numbers.en.js";
import { DEVTOOLS_RISCV_EN } from "./devtools.riscv.en.js";
import { DEVTOOLS_ENCODING_EN } from "./devtools.encoding.en.js";
import { DEVTOOLS_DATA_EN } from "./devtools.data.en.js";
import { DEVTOOLS_TEXT_EN } from "./devtools.text.en.js";
import { DEVTOOLS_DESIGN_EN } from "./devtools.design.en.js";
import { DEVTOOLS_CRYPTO_EN } from "./devtools.crypto.en.js";
import { DEVTOOLS_SYSTEM_EN } from "./devtools.system.en.js";
import { DEVTOOLS_TIME_EN } from "./devtools.time.en.js";

export const devtoolsEn = {
  name: {
    "number-base": "Number bases",
    "integer-inspector": "Integer inspector",
    bitwise: "Bitwise operations",
    "data-unit": "Data units",
    "float-convert": "Floating-point numbers",
    "mx-block": "Micro-scaled blocks",
    riscv: "RISC-V instructions",
    base64: "Base64",
    "url-encode": "URL encoding",
    "url-parse": "URL parts",
    "ascii-binary-hex": "Text to bytes",
    "unicode-inspector": "Unicode inspector",
    "html-entities": "HTML entities",
    hexdump: "Hex dump",
    "json-editor": "JSON tool",
    "yaml-editor": "YAML tool",
    "xml-editor": "XML tool",
    "data-format": "Format conversion",
    "json-to-types": "JSON to types",
    uuid: "Identifiers",
    diff: "Text comparison",
    "markdown-table": "Markdown table",
    lorem: "Filler text",
    slug: "Slug",
    "case-convert": "Naming form",
    "line-tools": "Line tools",
    regex: "Regular expressions",
    "color-convert": "Colour converter",
    "color-palette": "Colour palette",
    gradient: "Gradient",
    "cubic-bezier": "Bézier curve",
    contrast: "Contrast",
    "color-mixer": "Colour mixing",
    "token-gen": "Token generator",
    "password-gen": "Password generator",
    jwt: "JWT",
    hashing: "Hash and HMAC",
    aes: "AES",
    "rsa-keygen": "RSA keys",
    "rsa-crypt": "RSA encryption",
    signature: "Digital signature",
    "http-status": "HTTP codes",
    "path-convert": "Paths",
    cidr: "IP and CIDR",
    semver: "Semantic versions",
    qr: "QR code",
    datetime: "Time and date",
    cron: "Cron expression",
  },
  blurb: {
    "number-base": "Converts a whole number between bases 2 and 36, without losing a single bit.",
    "integer-inspector":
      "The same number as int8/16/32/64 and uint8/16/32/64 — with two's complement, range and byte order.",
    bitwise: "AND, OR, XOR, NOT, shifts and rotations on 8, 16, 32 or 64 bits.",
    "data-unit":
      "Bytes and bits through decimal (1000) and binary (1024) units — without mixing up kB and KiB.",
    "float-convert":
      "The same number through fp64, fp32, tf32, bf16, fp16, fp8 (e5m2/e4m3, and fnuz), mxfp6, mxfp4 and e8m0 — bit by bit, exactly.",
    "mx-block":
      "An OCP MX block of 32 elements: a shared E8M0 exponent, mxfp4/6/8 per element, and what it really costs in bits.",
    riscv:
      "Assembles and disassembles RV32/RV64 instructions — I, M, A, Zicsr and the compressed C form, with the fields bit by bit.",
    base64: "Base64 encoding and decoding — both alphabets, with and without padding.",
    "url-encode": "Three different percent-encodings and why they differ.",
    "url-parse": "Breaks a URL into scheme, host, port, path, parameters and fragment.",
    "ascii-binary-hex": "Text as code points, hex bytes, binary bytes and characters — and back.",
    "unicode-inspector":
      "Every code point, its bytes and category, plus the four normalisations.",
    "html-entities": "Entity encoding and decoding, with a table of named entities.",
    hexdump: "A canonical hex dump with an ASCII column, and reading a dump back into bytes.",
    "json-editor": "Formatting, validation and search of JSON — with the exact position of an error.",
    "yaml-editor": "Reads and writes YAML, and refuses by name what it does not support.",
    "xml-editor": "Edits XML and HTML, checks validity and searches with XPath.",
    "data-format":
      "Converts JSON, YAML, TOML and CSV into one another — and says up front what it cannot carry over.",
    "json-to-types": "Turns a JSON sample into TypeScript types or a Zod schema.",
    uuid: "Make a UUID v4, v7 or ULID, and read what an existing one says.",
    diff: "Compare two texts line by line or word by word.",
    "markdown-table": "Turn a table into Markdown and read it back.",
    lorem: "Random text for mock-ups, Latin or Serbian.",
    slug: "A title into URL form, from Cyrillic and from our letters.",
    "case-convert": "Switch a name into camelCase, snake_case and eight other forms.",
    "line-tools": "Sort, clean, number and wrap lines.",
    regex: "Test a pattern, see the matches and prepare a replacement.",
    "color-convert": "Converts a colour between hex, rgb, hsl, hwb, lab, lch, oklab and oklch notation.",
    "color-palette":
      "Makes lighter and darker shades and harmonies from one colour, in the OKLCH space.",
    gradient: "Builds a linear, radial or conic gradient and samples it without a browser.",
    "cubic-bezier": "Computes a CSS cubic-bezier easing curve and draws it from samples.",
    contrast: "Measures the contrast of a pair of colours by WCAG 2.1 and by APCA Lc.",
    "color-mixer":
      "Mixes colours by weight in sRGB, linear RGB and the Oklab space, and composites them by alpha.",
    "token-gen": "Random tokens in hex, base64url, base58 or a custom alphabet.",
    "password-gen": "Passwords by character group or passphrases from a word list, with entropy in bits.",
    jwt: "Breaks a token apart, names the claims and verifies the signature — alg: none never passes.",
    hashing: "SHA-1, SHA-256, SHA-384 and SHA-512 over text, with HMAC and output in hex and base64.",
    aes:
      "AES-GCM and AES-CBC with a direct key or a password through PBKDF2, in an envelope that carries the IV.",
    "rsa-keygen": "Makes an RSA-OAEP or RSA-PSS pair at 2048, 3072 or 4096 bits, as PEM.",
    "rsa-crypt": "RSA-OAEP over a pasted PEM key, with the message length limit stated plainly.",
    signature: "Signs and verifies with RSA-PSS, RSASSA-PKCS1-v1_5 and ECDSA on P-256 and P-384.",
    "http-status": "The whole register of HTTP statuses, explaining when each one is sent.",
    "path-convert": "Translate a path between Windows, UNIX, WSL, UNC and a file URL.",
    cidr: "Break down an IPv4 or IPv6 block — network, range, mask and subnets.",
    semver: "Compare versions and check whether a version falls into a range.",
    qr: "Makes a QR code from text, a link, a Wi-Fi network or a contact.",
    datetime: "One instant in every notation — Unix, ISO, RFC 2822, FILETIME and .NET ticks.",
    cron:
      "Explains a crontab in English and computes the next runs, with the real Vixie rule for days.",
  },

  /* One group per category of the rail — see the header. */
  numbers: DEVTOOLS_NUMBERS_EN,
  riscv: DEVTOOLS_RISCV_EN,
  encoding: DEVTOOLS_ENCODING_EN,
  data: DEVTOOLS_DATA_EN,
  text: DEVTOOLS_TEXT_EN,
  design: DEVTOOLS_DESIGN_EN,
  crypto: DEVTOOLS_CRYPTO_EN,
  system: DEVTOOLS_SYSTEM_EN,
  time: DEVTOOLS_TIME_EN,
} as const;
