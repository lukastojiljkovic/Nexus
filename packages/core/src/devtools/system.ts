/**
 * The developer drawer's SYSTEM references: identifiers, HTTP status codes,
 * filesystem paths, IP blocks and semantic versions.
 *
 * **Five tools in one module because they share a discipline, not a domain.**
 * Every grammar here is one somebody else published — RFC 9562, the IANA status
 * registry, RFC 5952, semver.org — and the whole value of a reference tool is
 * that it answers what the specification says rather than what a plausible
 * implementation would guess. So each parser REFUSES input it does not admit
 * instead of repairing it, and each conversion says „there is no answer" instead
 * of inventing one. Four places where that costs a convenience, deliberately:
 *
 * - `192.168.001.1` is refused. A leading zero means octal to one resolver and
 *   decimal to another, so the same text is two different addresses; picking one
 *   is how SSRF filters get walked past.
 * - `C:\Users\x` has no UNIX spelling and the converter says so. A drive letter
 *   is not a directory, and answering `/c/Users/x` would be a path that exists
 *   nowhere.
 * - `notes:v2` has no Windows spelling either. It is one perfectly ordinary
 *   POSIX filename, but `name:stream` is how Win32 addresses an NTFS Alternate
 *   Data Stream, so writing it back unchanged would name a stream on a file
 *   called `notes` — a different thing, offered without a word.
 * - A UUID whose variant bits are not the RFC's still parses, and reports the
 *   variant it actually has. Its version nibble is then reported as what the
 *   bits say while the doc comment records that the field is meaningless outside
 *   variant `rfc4122` — a reader is better served by „these bits say 12" than by
 *   a refusal that hides which byte is wrong.
 *
 * **Randomness and „now" are parameters, never ambient.** `createIdGenerator`
 * takes a `RandomPort` and every generator takes the millisecond; nothing here
 * reads `Date.now()` or `crypto` behind the caller's back. That is what makes
 * the v7 monotonic counter testable at all — the interesting behaviour is what
 * happens on the SECOND call inside one millisecond, and a module that fetched
 * its own clock could only be tested by hoping.
 *
 * **`packages/db/src/ids.ts` already has a `uuidv7` and it is deliberately not
 * reused.** That one imports `node:crypto` and reads the process clock, so it
 * cannot run in a renderer or a browser, and it is not monotonic — two ids minted
 * in the same millisecond are unordered, which is right for a database primary
 * key drawn once per row and wrong for a tool whose whole demonstration is
 * „press it ten times and watch them sort". Neither module should grow toward
 * the other: the db one is a dependency of the storage layer and must stay
 * boring.
 *
 * No `node:*`, no DOM, no network — this runs in the Electron main process, in
 * the renderer, and in a browser, unchanged.
 */

import { foldSearchText } from "../search/searchText.js";
import type { RandomPort } from "./random.js";

/* --------------------------------------------------------------- randomness */

/** Bytes as one big-endian integer. `for…of` over a `Uint8Array` yields `number`, never `undefined`. */
function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

/* -------------------------------------------------------------- identifiers */

/** 48 bits of Unix milliseconds is the span both UUIDv7 and ULID reserve for a timestamp. */
const MAX_TIMESTAMP_MS = 2 ** 48 - 1;

/** Rejects a „now" that cannot be a millisecond count — a CALLER bug (a clock reading), not user input. */
function assertTimestamp(nowMs: number): void {
  if (!Number.isInteger(nowMs) || nowMs < 0 || nowMs > MAX_TIMESTAMP_MS) {
    throw new RangeError(`nowMs must be an integer in [0, ${MAX_TIMESTAMP_MS}]`);
  }
}

/** A 128-bit value in the canonical lowercase hyphenated 8-4-4-4-12 spelling. */
function uuidFromValue(value: bigint): string {
  const hex = value.toString(16).padStart(32, "0");
  const groups = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20)];
  return `${groups.join("-")}-${hex.slice(20)}`;
}

/** The RFC 9562 variant bits: clear bits 63–62 and set them to `10`. */
function withRfcVariant(value: bigint): bigint {
  return (value & ~(0b11n << 62n)) | (0b10n << 62n);
}

/** The RFC 9562 version nibble sits at bits 79–76 — the high half of octet 6. */
function withVersion(value: bigint, version: bigint): bigint {
  return (value & ~(0xfn << 76n)) | (version << 76n);
}

/**
 * Crockford base32 (Douglas Crockford, „Base32", 2019): the digits, then the
 * uppercase letters with I, L, O and U removed — I/L/O because they are read as
 * 1/1/0, U because excluding it keeps accidental obscenities out of generated
 * ids. ULID mandates this alphabet.
 */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Crockford's DECODING table, which is deliberately wider than the encoding
 * alphabet: the specification says a decoder treats I, i, L and l as 1 and O and
 * o as 0, because those are exactly the characters a person mistypes when
 * copying one out. Accepting them is the published rule, not a repair — U stays
 * refused, since it is not a substitution for anything.
 */
const CROCKFORD_VALUES: ReadonlyMap<string, number> = new Map<string, number>([
  ...[...CROCKFORD].map((char, index) => [char, index] as const),
  ...[...CROCKFORD.toLowerCase()].map((char, index) => [char, index] as const),
  ["i", 1],
  ["I", 1],
  ["l", 1],
  ["L", 1],
  ["o", 0],
  ["O", 0],
]);

/** `value` in exactly `length` Crockford characters, zero-padded on the left. */
function encodeCrockford(value: bigint, length: number): string {
  let out = "";
  let rest = value;
  for (let i = 0; i < length; i += 1) {
    out = `${CROCKFORD[Number(rest & 31n)] ?? "0"}${out}`;
    rest >>= 5n;
  }
  return out;
}

/** A Crockford run as an integer, or `null` when any character is outside the decoding table. */
function decodeCrockford(text: string): bigint | null {
  let value = 0n;
  for (const char of text) {
    const digit = CROCKFORD_VALUES.get(char);
    if (digit === undefined) return null;
    value = (value << 5n) | BigInt(digit);
  }
  return value;
}

/** How many characters a ULID spends on its timestamp and on its randomness. */
const ULID_TIME_CHARS = 10;
const ULID_RANDOM_CHARS = 16;
const ULID_LENGTH = ULID_TIME_CHARS + ULID_RANDOM_CHARS;
const ULID_MAX_RANDOM = (1n << 80n) - 1n;

/**
 * The three time-ordered identifiers, sharing one randomness port and, for the
 * two that need it, the monotonic state.
 *
 * **Monotonicity is why this is an object and not four loose functions.** Both
 * UUIDv7 and ULID promise that ids minted in the same millisecond still sort in
 * the order they were minted, and neither can promise that without remembering
 * the previous call. Hiding that state in a module-level variable would make the
 * ordering depend on who else imported the module; making the caller pass it
 * would make the ordinary case ugly. A generator the caller creates once is the
 * honest shape: the state's lifetime is visible, and two generators are two
 * independent id spaces.
 *
 * The state is also what defends against a clock that goes backwards — an NTP
 * step or a user changing the timezone. A timestamp is never allowed to move
 * back: the last one is reused and the counter advances instead.
 */
export interface IdGenerator {
  /** RFC 9562 §5.4 — 122 random bits, and nothing else. No ordering, by design. */
  readonly uuidV4: () => string;
  /** RFC 9562 §5.7 — 48-bit big-endian Unix milliseconds, then a counter, then randomness. */
  readonly uuidV7: (nowMs: number) => string;
  /** ULID — the same idea in 26 Crockford characters, so it is sortable as TEXT as well as as bytes. */
  readonly ulid: (nowMs: number) => string;
}

/**
 * The counter method, RFC 9562 §6.2 „Fixed Bit-Length Dedicated Counter": the
 * 12 bits of `rand_a` hold a counter that is re-seeded randomly whenever the
 * millisecond advances and incremented on every id inside one.
 *
 * **The seed is 8 bits, not 12, and the four spare bits are the point.** Seeding
 * across the whole 12-bit range would, on average, leave only half the counter
 * available before it rolls over, and a roll-over inside a millisecond forces the
 * timestamp forward into the future. Seeding into the low 256 leaves at least
 * 3 840 ids per millisecond — far past any burst a UI can produce — while still
 * randomising the starting point so consecutive ids do not advertise how many
 * were minted.
 */
const V7_COUNTER_BITS = 12n;
const V7_COUNTER_MAX = (1n << V7_COUNTER_BITS) - 1n;
const V7_SEED_MAX = 0xff;
const V7_TAIL_MASK = (1n << 62n) - 1n;

export function createIdGenerator(random: RandomPort): IdGenerator {
  let v7Ms = -1;
  let v7Counter = 0n;
  let ulidMs = -1;
  let ulidRandom = 0n;

  return {
    uuidV4: () => {
      const value = bytesToBigInt(random.bytes(16));
      return uuidFromValue(withRfcVariant(withVersion(value, 4n)));
    },

    uuidV7: (nowMs) => {
      assertTimestamp(nowMs);
      if (nowMs > v7Ms) {
        v7Ms = nowMs;
        v7Counter = bytesToBigInt(random.bytes(1)) & BigInt(V7_SEED_MAX);
      } else if (v7Counter >= V7_COUNTER_MAX) {
        // Borrowing a millisecond from the future is the lesser evil: the
        // alternative is emitting an id that sorts before its predecessor.
        v7Ms += 1;
        v7Counter = bytesToBigInt(random.bytes(1)) & BigInt(V7_SEED_MAX);
      } else {
        v7Counter += 1n;
      }
      const tail = bytesToBigInt(random.bytes(8)) & V7_TAIL_MASK;
      return uuidFromValue(
        (BigInt(v7Ms) << 80n) | (7n << 76n) | (v7Counter << 64n) | (0b10n << 62n) | tail,
      );
    },

    ulid: (nowMs) => {
      assertTimestamp(nowMs);
      if (nowMs > ulidMs) {
        ulidMs = nowMs;
        ulidRandom = bytesToBigInt(random.bytes(10)) & ULID_MAX_RANDOM;
      } else if (ulidRandom >= ULID_MAX_RANDOM) {
        ulidMs += 1;
        ulidRandom = bytesToBigInt(random.bytes(10)) & ULID_MAX_RANDOM;
      } else {
        // The ULID specification's own monotonic rule: increment the random
        // component rather than redraw it, so the order is guaranteed and not
        // merely likely.
        ulidRandom += 1n;
      }
      return (
        encodeCrockford(BigInt(ulidMs), ULID_TIME_CHARS) +
        encodeCrockford(ulidRandom, ULID_RANDOM_CHARS)
      );
    },
  };
}

/**
 * The four variants the layout of octet 8 can name. `rfc4122` is what RFC 9562
 * calls variant 1 and what every version-1-to-8 UUID uses; the other three exist
 * because real systems still hold ids minted before the RFC (`ncs`) or by
 * Windows' own GUID generator in its early years (`microsoft`).
 */
export const UUID_VARIANTS = ["ncs", "rfc4122", "microsoft", "future"] as const;

export type UuidVariant = (typeof UUID_VARIANTS)[number];

export interface ParsedUuid {
  /** Lowercase, hyphenated, no braces and no `urn:` prefix — whatever spelling came in. */
  readonly canonical: string;
  readonly variant: UuidVariant;
  /**
   * The version nibble as the bits actually read, 0–15. **Only meaningful under
   * the `rfc4122` variant** — under any other, those four bits belong to the
   * timestamp or to nothing at all, and a surface must not label them „version".
   */
  readonly version: number;
  /**
   * Unix milliseconds embedded in the id, for the three versions that carry a
   * timestamp (1, 6 and 7); `null` for every other version and for a non-RFC
   * variant. Versions 1 and 6 count 100-nanosecond intervals from 1582-10-15, so
   * the sub-millisecond remainder is discarded here — a reference tool showing a
   * date does not need it, and carrying a fraction of a millisecond in a field
   * called `timestampMs` would be worse than dropping it.
   */
  readonly timestampMs: number | null;
  /** The two ids RFC 9562 §5.9/§5.10 give fixed meanings, since neither is a real identifier. */
  readonly special: "nil" | "max" | null;
}

/**
 * Accepted spellings, and nothing else: the canonical 8-4-4-4-12 form, the same
 * wrapped in braces, the same behind a `urn:uuid:` prefix, and 32 bare hex
 * digits. Case is free. A string with the hyphens in other places is refused
 * rather than stripped — that is not a UUID written differently, it is a
 * different string, and a tool that silently accepted it would report a
 * confident version for a typo.
 */
const UUID_CANONICAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID_BARE = /^[0-9a-f]{32}$/;

/** 100-nanosecond intervals between the Gregorian epoch (1582-10-15) and 1970-01-01. */
const GREGORIAN_OFFSET_100NS = 122_192_928_000_000_000n;

export function parseUuid(text: string): ParsedUuid | null {
  let body = text.trim().toLowerCase();
  if (body.startsWith("urn:uuid:")) body = body.slice("urn:uuid:".length);
  if (body.startsWith("{") && body.endsWith("}")) body = body.slice(1, -1);

  const hex = UUID_CANONICAL.test(body)
    ? body.replaceAll("-", "")
    : UUID_BARE.test(body)
      ? body
      : null;
  if (hex === null) return null;

  const value = BigInt(`0x${hex}`);
  const variant = readVariant(value);
  const version = Number((value >> 76n) & 0xfn);

  return {
    canonical: uuidFromValue(value),
    variant,
    version,
    timestampMs: variant === "rfc4122" ? readUuidTimestamp(value, version) : null,
    special: value === 0n ? "nil" : value === (1n << 128n) - 1n ? "max" : null,
  };
}

function readVariant(value: bigint): UuidVariant {
  if ((value >> 63n) % 2n === 0n) return "ncs";
  if ((value >> 62n) % 4n === 0b10n) return "rfc4122";
  if ((value >> 61n) % 8n === 0b110n) return "microsoft";
  return "future";
}

function readUuidTimestamp(value: bigint, version: number): number | null {
  if (version === 7) return Number(value >> 80n);

  // Versions 1 and 6 hold the SAME 60-bit Gregorian count, split into different
  // fields — v6 exists only to move the high bits to the front so the ids sort.
  const timeLow32 = (value >> 96n) & 0xffff_ffffn;
  const timeMid16 = (value >> 80n) & 0xffffn;
  const timeLow12 = (value >> 64n) & 0x0fffn;

  const gregorian =
    version === 1
      ? (timeLow12 << 48n) | (timeMid16 << 32n) | timeLow32
      : version === 6
        ? (timeLow32 << 28n) | (timeMid16 << 12n) | timeLow12
        : null;

  return gregorian === null ? null : Number((gregorian - GREGORIAN_OFFSET_100NS) / 10_000n);
}

export interface ParsedUlid {
  /** Uppercase, 26 characters — the only spelling a ULID is written in. */
  readonly canonical: string;
  readonly timestampMs: number;
  /** The 80 random bits, as an integer, so two ULIDs from one millisecond can be compared. */
  readonly randomness: bigint;
}

/**
 * A ULID's 26 characters, refusing three things: a length other than 26, a
 * character outside Crockford's decoding table (`U` most of all), and a
 * timestamp above 2^48−1. That last one is real rather than theoretical — ten
 * base32 characters carry 50 bits while the timestamp field is 48, so
 * `ZZZZZZZZZZ…` decodes to a number no ULID may hold and a decoder that ignored
 * the top two bits would happily report a date in the year 10 889.
 */
export function parseUlid(text: string): ParsedUlid | null {
  const body = text.trim();
  if (body.length !== ULID_LENGTH) return null;

  const time = decodeCrockford(body.slice(0, ULID_TIME_CHARS));
  const randomness = decodeCrockford(body.slice(ULID_TIME_CHARS));
  if (time === null || randomness === null || time > BigInt(MAX_TIMESTAMP_MS)) return null;

  return {
    canonical:
      encodeCrockford(time, ULID_TIME_CHARS) + encodeCrockford(randomness, ULID_RANDOM_CHARS),
    timestampMs: Number(time),
    randomness,
  };
}

/* ------------------------------------------------------------- http status */

/** The five classes, which are the first digit and nothing more. */
export const HTTP_STATUS_CLASSES = ["1xx", "2xx", "3xx", "4xx", "5xx"] as const;

export type HttpStatusClass = (typeof HTTP_STATUS_CLASSES)[number];

export interface HttpStatus {
  readonly code: number;
  /** The registered reason phrase, in English. It is protocol text, so it is not translated. */
  readonly name: string;
  /** Where the code is defined: an RFC with its section, or the vendor that ships it unregistered. */
  readonly reference: string;
  /** One Serbian line saying WHEN this code is the right answer — what a registry table never tells you. */
  readonly noteSr: string;
  readonly statusClass: HttpStatusClass;
  /** `false` for codes that are widely deployed but were never registered with IANA. */
  readonly official: boolean;
}

/** The class of any code, or `null` — 099 and 600 are not statuses, they are typos. */
export function httpStatusClass(code: number): HttpStatusClass | null {
  if (!Number.isInteger(code) || code < 100 || code > 599) return null;
  return HTTP_STATUS_CLASSES[Math.floor(code / 100) - 1] ?? null;
}

/** Terser than repeating the class in seventy-odd rows, and it can never disagree with the code. */
function status(
  code: number,
  name: string,
  reference: string,
  noteSr: string,
  official = true,
): HttpStatus {
  return { code, name, reference, noteSr, statusClass: httpStatusClass(code) ?? "5xx", official };
}

/**
 * The IANA HTTP Status Code Registry, plus the unregistered codes people
 * actually meet.
 *
 * **The unofficial ones are in the table rather than in a footnote.** A
 * developer looking up 521 has exactly one question — „what is this" — and a
 * reference that omits it because it is not registered has failed at the only
 * moment it was wanted. They carry `official: false` and name their vendor, so
 * nothing is passed off as standard; what is not done is pretending they do not
 * exist.
 *
 * **Codes the registry keeps but nobody should send are here too**, with the
 * reason in the note: 305 was withdrawn as a security problem, 306 was never
 * assigned, 418 is a joke the registry now holds reserved so nothing else takes
 * it, and 510's defining RFC has been moved to Historic.
 *
 * Rows are in ascending code order — for the reader, and because
 * `searchHttpStatuses` returns them in table order.
 */
export const HTTP_STATUSES: readonly HttpStatus[] = [
  status(100, "Continue", "RFC 9110, 15.2.1",
    "Nastavi sa slanjem tela — odgovor na Expect: 100-continue."),
  status(101, "Switching Protocols", "RFC 9110, 15.2.2",
    "Server prihvata prelazak na drugi protokol, najčešće WebSocket."),
  status(102, "Processing", "RFC 2518",
    "WebDAV: zahtev je primljen i obrađuje se, pravi odgovor tek sledi."),
  status(103, "Early Hints", "RFC 8297",
    "Rana zaglavlja (obično Link) pre nego što stigne konačni odgovor."),
  status(200, "OK", "RFC 9110, 15.3.1",
    "Zahtev je uspeo; telo nosi traženi rezultat."),
  status(201, "Created", "RFC 9110, 15.3.2",
    "Resurs je napravljen; zaglavlje Location pokazuje gde se nalazi."),
  status(202, "Accepted", "RFC 9110, 15.3.3",
    "Primljeno na obradu, ali obrada nije završena niti zagarantovana."),
  status(203, "Non-Authoritative Information", "RFC 9110, 15.3.4",
    "Odgovor je usput izmenio posrednik — nije original sa izvora."),
  status(204, "No Content", "RFC 9110, 15.3.5",
    "Uspelo, a odgovor namerno nema telo."),
  status(205, "Reset Content", "RFC 9110, 15.3.6",
    "Uspelo; klijent treba da isprazni formu koju je poslao."),
  status(206, "Partial Content", "RFC 9110, 15.3.7",
    "Delimičan odgovor na Range zahtev — nastavak preuzimanja."),
  status(207, "Multi-Status", "RFC 4918",
    "WebDAV: jedno telo koje nosi poseban status za svaki resurs."),
  status(208, "Already Reported", "RFC 5842",
    "WebDAV: ovaj resurs je već naveden ranije u istom odgovoru."),
  status(218, "This Is Fine", "Apache HTTP Server",
    "Apache vraća 2xx umesto greške kada je ProxyErrorOverride isključen.", false),
  status(226, "IM Used", "RFC 3229",
    "Odgovor je rezultat delta-kodiranja traženog kroz A-IM."),
  status(300, "Multiple Choices", "RFC 9110, 15.4.1",
    "Postoji više predstava resursa; klijent bira jednu."),
  status(301, "Moved Permanently", "RFC 9110, 15.4.2",
    "Trajno premešteno — ažuriraj link i zapamti preusmerenje."),
  status(302, "Found", "RFC 9110, 15.4.3",
    "Privremeno drugde; klijenti u praksi prelaze na GET, što 307 sprečava."),
  status(303, "See Other", "RFC 9110, 15.4.4",
    "Rezultat pogledaj na drugoj adresi, obavezno preko GET-a."),
  status(304, "Not Modified", "RFC 9110, 15.4.5",
    "Keš je i dalje svež; nema tela, koristi sačuvanu kopiju."),
  status(305, "Use Proxy", "RFC 9110, 15.4.6",
    "Povučeno iz bezbednosnih razloga — ne šalje se i ne poštuje."),
  status(306, "(Unused)", "RFC 9110, 15.4.7",
    "Broj koji je registar zauzeo a nikada nije dodelio."),
  status(307, "Temporary Redirect", "RFC 9110, 15.4.8",
    "Privremeno, uz obavezno očuvanje metode i tela zahteva."),
  status(308, "Permanent Redirect", "RFC 9110, 15.4.9",
    "Trajno, uz obavezno očuvanje metode i tela zahteva."),
  status(400, "Bad Request", "RFC 9110, 15.5.1",
    "Zahtev je neispravan i server ga uopšte ne razume."),
  status(401, "Unauthorized", "RFC 9110, 15.5.2",
    "Zapravo „neautentifikovan“ — prijava nedostaje ili ne valja."),
  status(402, "Payment Required", "RFC 9110, 15.5.3",
    "Rezervisano za naplatu; u praksi ga svako koristi na svoj način."),
  status(403, "Forbidden", "RFC 9110, 15.5.4",
    "Identitet je poznat, ali pravo pristupa ne postoji."),
  status(404, "Not Found", "RFC 9110, 15.5.5",
    "Server nema ništa na toj adresi i ne kaže zašto."),
  status(405, "Method Not Allowed", "RFC 9110, 15.5.6",
    "Metoda nije dozvoljena; zaglavlje Allow nabraja koje jesu."),
  status(406, "Not Acceptable", "RFC 9110, 15.5.7",
    "Nijedna dostupna predstava ne odgovara Accept zaglavljima."),
  status(407, "Proxy Authentication Required", "RFC 9110, 15.5.8",
    "Posrednik traži prijavu pre nego što propusti zahtev."),
  status(408, "Request Timeout", "RFC 9110, 15.5.9",
    "Klijent nije poslao zahtev na vreme; server zatvara vezu."),
  status(409, "Conflict", "RFC 9110, 15.5.10",
    "Zahtev se kosi sa trenutnim stanjem resursa."),
  status(410, "Gone", "RFC 9110, 15.5.11",
    "Namerno uklonjeno i neće se vratiti — jače tvrđenje od 404."),
  status(411, "Length Required", "RFC 9110, 15.5.12",
    "Server odbija telo bez zaglavlja Content-Length."),
  status(412, "Precondition Failed", "RFC 9110, 15.5.13",
    "Uslov iz If-Match ili If-Unmodified-Since nije ispunjen."),
  status(413, "Content Too Large", "RFC 9110, 15.5.14",
    "Telo zahteva je veće nego što server prihvata."),
  status(414, "URI Too Long", "RFC 9110, 15.5.15",
    "Adresa je duža nego što server prihvata."),
  status(415, "Unsupported Media Type", "RFC 9110, 15.5.16",
    "Content-Type tela nije podržan na ovom resursu."),
  status(416, "Range Not Satisfiable", "RFC 9110, 15.5.17",
    "Traženi opseg je van veličine resursa."),
  status(417, "Expectation Failed", "RFC 9110, 15.5.18",
    "Server ne može da ispuni ono što zaglavlje Expect traži."),
  status(418, "(Unused)", "RFC 9110, 15.5.19",
    "Broj iz aprilske šale (RFC 2324); registar ga drži zauzetim."),
  status(419, "Page Expired", "Laravel",
    "Laravel: CSRF token je istekao, pa formu treba poslati ponovo.", false),
  status(421, "Misdirected Request", "RFC 9110, 15.5.20",
    "Zahtev je stigao na server koji ne opslužuje taj domen."),
  status(422, "Unprocessable Content", "RFC 9110, 15.5.21",
    "Sintaksa je ispravna, ali sadržaj semantički ne prolazi."),
  status(423, "Locked", "RFC 4918",
    "WebDAV: resurs je zaključan."),
  status(424, "Failed Dependency", "RFC 4918",
    "WebDAV: zavisni zahtev nije uspeo, pa ni ovaj ne može."),
  status(425, "Too Early", "RFC 8470",
    "Server odbija da rizikuje ponavljanje 0-RTT zahteva."),
  status(426, "Upgrade Required", "RFC 9110, 15.5.22",
    "Nastavak je moguć samo preko protokola iz zaglavlja Upgrade."),
  status(428, "Precondition Required", "RFC 6585",
    "Server traži uslovni zahtev da spreči izgubljenu izmenu."),
  status(429, "Too Many Requests", "RFC 6585",
    "Prekoračena je granica broja zahteva; vidi Retry-After."),
  status(431, "Request Header Fields Too Large", "RFC 6585",
    "Zaglavlja su prevelika — najčešće predugačak kolačić."),
  status(451, "Unavailable For Legal Reasons", "RFC 7725",
    "Sadržaj je nedostupan zbog pravne zabrane."),
  status(499, "Client Closed Request", "nginx",
    "nginx: klijent je prekinuo vezu pre nego što je odgovor stigao.", false),
  status(500, "Internal Server Error", "RFC 9110, 15.6.1",
    "Neočekivana greška na serveru, bez bližeg objašnjenja."),
  status(501, "Not Implemented", "RFC 9110, 15.6.2",
    "Server ne podržava metodu koja je zatražena."),
  status(502, "Bad Gateway", "RFC 9110, 15.6.3",
    "Posrednik je od uzvodnog servera dobio neispravan odgovor."),
  status(503, "Service Unavailable", "RFC 9110, 15.6.4",
    "Privremeno nedostupno — preopterećenje ili održavanje."),
  status(504, "Gateway Timeout", "RFC 9110, 15.6.5",
    "Uzvodni server nije odgovorio na vreme."),
  status(505, "HTTP Version Not Supported", "RFC 9110, 15.6.6",
    "Verzija HTTP-a iz zahteva nije podržana."),
  status(506, "Variant Also Negotiates", "RFC 2295",
    "Pogrešno podešeno pregovaranje o sadržaju na samom serveru."),
  status(507, "Insufficient Storage", "RFC 4918",
    "WebDAV: nema dovoljno prostora da se zahtev izvrši."),
  status(508, "Loop Detected", "RFC 5842",
    "WebDAV: obrada je zapala u beskonačnu petlju."),
  status(509, "Bandwidth Limit Exceeded", "Apache HTTP Server / cPanel",
    "Prekoračen je saobraćaj dozvoljen nalogu na hostingu.", false),
  status(510, "Not Extended", "RFC 2774 (Historic)",
    "Zastarelo: zahtevu nedostaje proširenje koje server traži."),
  status(511, "Network Authentication Required", "RFC 6585",
    "Mreža traži prijavu — tipičan zarobljeni portal na javnom Wi-Fi-ju."),
  status(520, "Web Server Returned an Unknown Error", "Cloudflare",
    "Cloudflare: izvorni server je vratio odgovor koji Cloudflare ne razume.", false),
  status(521, "Web Server Is Down", "Cloudflare",
    "Cloudflare: izvorni server je odbio vezu.", false),
  status(522, "Connection Timed Out", "Cloudflare",
    "Cloudflare: veza ka izvornom serveru nije uspostavljena na vreme.", false),
  status(523, "Origin Is Unreachable", "Cloudflare",
    "Cloudflare: izvorni server nije dostupan sa mreže.", false),
  status(524, "A Timeout Occurred", "Cloudflare",
    "Cloudflare: veza jeste uspostavljena, ali odgovor nije stigao na vreme.", false),
  status(525, "SSL Handshake Failed", "Cloudflare",
    "Cloudflare: TLS rukovanje sa izvornim serverom nije uspelo.", false),
  status(526, "Invalid SSL Certificate", "Cloudflare",
    "Cloudflare: sertifikat izvornog servera nije validan.", false),
  status(527, "Railgun Error", "Cloudflare (povučeno)",
    "Cloudflare: greška u Railgun sloju, koji je u međuvremenu ugašen.", false),
  status(530, "Origin DNS Error", "Cloudflare",
    "Cloudflare: uvek stiže uz zaseban 1xxx kod koji nosi pravi razlog.", false),
];

const HTTP_BY_CODE = new Map<number, HttpStatus>(
  HTTP_STATUSES.map((entry) => [entry.code, entry] as const),
);

/** The one status a code names, or `undefined`. */
export function findHttpStatus(code: number): HttpStatus | undefined {
  return HTTP_BY_CODE.get(code);
}

/** One to three digits is a CODE query; anything else is text. */
const DIGITS_ONLY = /^\d{1,3}$/;

/**
 * Search by code prefix or by words.
 *
 * **A numeric query is a PREFIX, not an exact match**, so „4" answers the whole
 * 4xx range and „50" answers 500–509 — which is how this actually gets used,
 * scanning a family rather than confirming a code already known. A text query is
 * folded through the app's Serbian search folding, so „istekao" finds 419 whether
 * or not the diacritics survived the paste, and the English reason phrases stay
 * searchable in the same field.
 *
 * Results keep the table's ascending order. There is no relevance ranking on
 * purpose: for a reference table „every 4xx, in order" is the useful answer, and
 * a ranked list only hides where a code sits among its neighbours.
 */
export function searchHttpStatuses(query: string): readonly HttpStatus[] {
  const trimmed = query.trim();
  if (trimmed === "") return HTTP_STATUSES;
  if (DIGITS_ONLY.test(trimmed)) {
    return HTTP_STATUSES.filter((entry) => String(entry.code).startsWith(trimmed));
  }
  const needle = foldSearchText(trimmed);
  return HTTP_STATUSES.filter(
    (entry) =>
      foldSearchText(entry.name).includes(needle) || foldSearchText(entry.noteSr).includes(needle),
  );
}

/* ------------------------------------------------------------------- paths */

/** The five spellings a path is met in on a Windows machine that also runs WSL. */
export const PATH_FLAVOURS = ["windows", "unix", "wsl", "unc", "file-url"] as const;

export type PathFlavour = (typeof PATH_FLAVOURS)[number];

/**
 * Why a conversion has no answer. Each of these is a real absence rather than a
 * missing feature, and every one of them is a place where a helpful-looking
 * invention would produce a path that names nothing.
 */
export const PATH_REFUSALS = [
  /** Not a path in any flavour this tool reads. */
  "unparsable",
  /** `C:foo` — resolved against a per-drive current directory that only the running process has. */
  "drive-relative",
  /** The target spelling needs a drive letter and the source has none. */
  "no-drive",
  /** The target spelling needs a host and a share and the source has neither. */
  "no-host",
  /** A drive letter or a network share has no plain POSIX spelling at all. */
  "no-unix-root",
  /** A file URL must be absolute; a relative path is not one. */
  "not-absolute",
  /** A segment Win32 reads as syntax or as a device rather than as the name it says it is. */
  "illegal-windows-name",
] as const;

export type PathRefusal = (typeof PATH_REFUSALS)[number];

/** Where a path starts. The one field that decides which conversions exist. */
export type PathRoot =
  | { readonly kind: "drive"; readonly letter: string }
  | { readonly kind: "unc"; readonly host: string; readonly share: string }
  | { readonly kind: "posix" }
  | { readonly kind: "relative" };

export interface ParsedPath {
  /** The flavour the text was RECOGNISED as, which is not necessarily the one it will be written back in. */
  readonly flavour: PathFlavour;
  readonly root: PathRoot;
  /** Normalised segments: no `.`, no empties, `..` already applied where it could be. */
  readonly segments: readonly string[];
  /** Preserved because `C:\dir\` and `C:\dir` mean different things to some tools, and the user typed one of them. */
  readonly trailingSeparator: boolean;
}

export type PathResult =
  | { readonly ok: true; readonly path: string; readonly flavour: PathFlavour }
  | { readonly ok: false; readonly reason: PathRefusal };

const DRIVE_ROOTED = /^([A-Za-z]):[\\/]/;
const DRIVE_RELATIVE = /^[A-Za-z]:(?![\\/])/;
const WSL_MOUNT = /^\/mnt\/([A-Za-z])(?=\/|$)/;
const FILE_URL = /^file:(?:\/\/([^/]*))?(\/.*)?$/i;
const DRIVE_SEGMENT = /^[A-Za-z]:$/;

/**
 * The characters Win32 will not hold inside a file name, and every one of them
 * is a character its path parser reads as SYNTAX rather than as a letter: `:`
 * opens an NTFS Alternate Data Stream, so `notes:v2` addresses a stream on a
 * file called `notes` and not a file called `notes:v2`; `*` and `?` are the
 * wildcards the find APIs expand; `<`, `>` and `|` are the command
 * interpreter's redirection operators; `"` is its quoting character; `/` and
 * `\` are separators, so a name holding one is two names; and everything below
 * U+0020 the API rejects outright.
 */
// eslint-disable-next-line no-control-regex -- the C0 range IS the point of this constant.
const WIN32_ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/;

/**
 * The MS-DOS device names, which are not a legacy curiosity: the Win32 path
 * parser still resolves them at EVERY level of a path, so `C:\logs\con\out.txt`
 * opens the console rather than a file under `logs`, and `con` therefore cannot
 * exist as an ordinary directory. The match is case-insensitive and stops at
 * the first dot, because the parser compares the name before the extension —
 * `CON.txt` is the console too.
 */
const WIN32_DEVICE = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;

/**
 * Whether Win32 would read `segment` as the name it says it is. This is the
 * check the module's stated philosophy demands and did not have: a string that
 * is one perfectly ordinary POSIX filename can be syntax to the Windows path
 * parser, and writing it back unchanged answers with a path that names
 * something else — which is worse than answering that there is no path.
 *
 * The ROOT is deliberately not put through here. A drive letter's colon and a
 * UNC host and share are consumed by the drive and redirector layers before the
 * filename parser runs at all, so `C:` — which would fail the very first rule —
 * is legal exactly where it appears and nowhere else.
 */
function isWindowsName(segment: string): boolean {
  if (WIN32_ILLEGAL.test(segment) || WIN32_DEVICE.test(segment)) return false;
  // A trailing dot or space is not refused by Win32, it is silently REMOVED, so
  // `report ` and `report` are one file to it. Emitting the first would be
  // naming the second — the same failure as the others, arriving quietly.
  return !/[ .]$/.test(segment);
}

function refuse(reason: PathRefusal): PathResult {
  return { ok: false, reason };
}

/**
 * `.` and `..` applied. A `..` that would climb above a ROOT is dropped, which
 * is what both kernels do (`/..` is `/`, and `C:\..` is `C:\`); a `..` at the
 * front of a RELATIVE path is kept, because there it names a real directory
 * nobody here knows the identity of.
 */
function normaliseSegments(parts: readonly string[], rooted: boolean): readonly string[] {
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part !== "..") {
      out.push(part);
      continue;
    }
    const last = out[out.length - 1];
    if (last !== undefined && last !== "..") out.pop();
    else if (!rooted) out.push("..");
  }
  return out;
}

type PathParse =
  | { readonly ok: true; readonly path: ParsedPath }
  | { readonly ok: false; readonly reason: PathRefusal };

/**
 * The one thing normalised before parsing: a matching pair of surrounding
 * quotes. Those are shell syntax rather than part of the name, and a path
 * copied out of a terminal arrives wearing them.
 */
function unquote(text: string): string {
  const trimmed = text.trim();
  const first = trimmed.slice(0, 1);
  if ((first === '"' || first === "'") && trimmed.length >= 2 && trimmed.endsWith(first)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readPath(text: string): PathParse {
  const raw = unquote(text);
  if (raw === "") return { ok: false, reason: "unparsable" };

  const trailingSeparator = /[\\/]$/.test(raw);

  if (/^file:/i.test(raw)) return readFileUrl(raw, trailingSeparator);

  // Only a DOUBLE BACKSLASH opens a UNC path. A leading `//` is left as a POSIX
  // root: the standard calls `//` implementation-defined, and reading it as a
  // host would silently turn `//home/luka` into a share on a machine called
  // „home" — a path that reaches the network instead of the disk.
  if (raw.startsWith("\\\\")) {
    const parts = raw.slice(2).split(/[\\/]+/);
    const [host = "", share = ""] = parts;
    if (host === "" || share === "") return { ok: false, reason: "unparsable" };
    return {
      ok: true,
      path: {
        flavour: "unc",
        root: { kind: "unc", host, share },
        segments: normaliseSegments(parts.slice(2), true),
        trailingSeparator,
      },
    };
  }

  const drive = DRIVE_ROOTED.exec(raw);
  if (drive !== null) {
    const letter = (drive[1] ?? "").toUpperCase();
    return {
      ok: true,
      path: {
        flavour: "windows",
        root: { kind: "drive", letter },
        segments: normaliseSegments(raw.slice(3).split(/[\\/]+/), true),
        trailingSeparator,
      },
    };
  }

  if (DRIVE_RELATIVE.test(raw)) return { ok: false, reason: "drive-relative" };

  const mount = WSL_MOUNT.exec(raw);
  if (mount !== null) {
    const letter = (mount[1] ?? "").toUpperCase();
    return {
      ok: true,
      path: {
        flavour: "wsl",
        root: { kind: "drive", letter },
        segments: normaliseSegments(raw.slice(mount[0].length).split("/"), true),
        trailingSeparator,
      },
    };
  }

  if (raw.startsWith("/")) {
    return {
      ok: true,
      path: {
        flavour: "unix",
        root: { kind: "posix" },
        segments: normaliseSegments(raw.split("/"), true),
        trailingSeparator,
      },
    };
  }

  // A relative path is split on backslashes ONLY when it contains one. A POSIX
  // filename may legally hold a backslash, and splitting on it unconditionally
  // would quietly cut `a\b` — one file — into two directories.
  const windowsish = raw.includes("\\");
  return {
    ok: true,
    path: {
      flavour: windowsish ? "windows" : "unix",
      root: { kind: "relative" },
      segments: normaliseSegments(raw.split(windowsish ? /[\\/]+/ : "/"), false),
      trailingSeparator,
    },
  };
}

/**
 * RFC 8089. `file:/path` (no authority) and `file://localhost/path` are both
 * accepted and both mean the same thing as `file:///path` — the RFC says so in
 * as many words, and a converter that refused either would be refusing what
 * real tools emit. A query or a fragment IS refused: `?` and `#` are URL
 * syntax, and a path tool that treated them as filename characters would hand
 * back a name that cannot be reached.
 */
function readFileUrl(raw: string, trailingSeparator: boolean): PathParse {
  if (raw.includes("?") || raw.includes("#")) return { ok: false, reason: "unparsable" };
  const match = FILE_URL.exec(raw);
  // `file:` with neither an authority nor a path names nothing; it is a scheme,
  // not a location, and answering `/` for it would invent a root.
  if (match === null || (match[1] === undefined && match[2] === undefined)) {
    return { ok: false, reason: "unparsable" };
  }

  const authority = (match[1] ?? "").toLowerCase();
  const host = authority === "localhost" ? "" : authority;
  const rawSegments = (match[2] ?? "/").split("/");

  const decoded: string[] = [];
  for (const segment of rawSegments) {
    let name: string;
    try {
      name = decodeURIComponent(segment);
    } catch {
      // A stray `%` that is not an escape. The name is unrecoverable, not
      // guessable — `%zz` could have been meant literally or mistyped.
      return { ok: false, reason: "unparsable" };
    }
    // `%2F` decodes to a separator INSIDE a name, and no filesystem this tool
    // writes for can hold one there. Splitting on it would answer with two
    // directories where the URL named one file, so the URL is refused instead.
    //
    // `%5C` is deliberately NOT refused alongside it, though the reasoning
    // reads as though it should be. A backslash is a separator only in the two
    // Win32 spellings: `body()` joins unix and wsl segments with `/`, so a
    // `posix` root is never written with one, and inside a POSIX name a
    // backslash is an ordinary character. Where it WOULD be read as a separator
    // — under a drive or a UNC root — `formatPath` refuses it by the Win32 name
    // rule rather than by cutting one name into two. Refusing it here was also
    // refusing this module's own output: `formatPath` percent-encodes a
    // backslash on the way into a URL, so the pair did not round-trip.
    if (name.includes("/")) return { ok: false, reason: "unparsable" };
    decoded.push(name);
  }

  const normalised = normaliseSegments(decoded, true);
  const first = normalised[0];

  if (host === "" && first !== undefined && DRIVE_SEGMENT.test(first)) {
    return {
      ok: true,
      path: {
        flavour: "file-url",
        root: { kind: "drive", letter: first.slice(0, 1).toUpperCase() },
        segments: normalised.slice(1),
        trailingSeparator,
      },
    };
  }

  if (host !== "") {
    const share = normalised[0];
    if (share === undefined) return { ok: false, reason: "unparsable" };
    return {
      ok: true,
      path: {
        flavour: "file-url",
        root: { kind: "unc", host, share },
        segments: normalised.slice(1),
        trailingSeparator,
      },
    };
  }

  return {
    ok: true,
    path: {
      flavour: "file-url",
      root: { kind: "posix" },
      segments: normalised,
      trailingSeparator,
    },
  };
}

/** A path in whatever flavour the text is written in, or `null`. `convertPath` says WHY when this returns `null`. */
export function parsePath(text: string): ParsedPath | null {
  const outcome = readPath(text);
  return outcome.ok ? outcome.path : null;
}

/** Joined with `separator`, with the trailing one restored only when there was something to trail. */
function body(path: ParsedPath, separator: string): string {
  const joined = path.segments.join(separator);
  const tail = path.trailingSeparator && path.segments.length > 0 ? separator : "";
  return joined + tail;
}

function ok(path: string, flavour: PathFlavour): PathResult {
  return { ok: true, path, flavour };
}

/** A relative path with nothing left in it is `.` — the empty string is not a path. */
function relativeBody(path: ParsedPath, separator: string): string {
  const text = body(path, separator);
  return text === "" ? "." : text;
}

/** The one place a segment becomes URL text. Per segment, so an encoded `/` cannot become a separator. */
function encodeSegments(segments: readonly string[]): string {
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}

/** `parsed`, written in another flavour — or the reason there is no such spelling. */
export function formatPath(parsed: ParsedPath, to: PathFlavour): PathResult {
  const root = parsed.root;

  // The one place the Win32 name rules are applied, and it is here rather than
  // inside a branch because the question is asked by the TARGET flavour and not
  // by the root: `windows` writes drive-rooted, UNC-rooted and relative paths,
  // `unc` writes the same segments a second time, and every one of those strings
  // is handed back to the same path parser. It is asked before the root question
  // because a name Win32 cannot hold has no Win32 spelling whatever root is put
  // in front of it.
  if ((to === "windows" || to === "unc") && !parsed.segments.every(isWindowsName)) {
    return refuse("illegal-windows-name");
  }

  if (to === "windows") {
    if (root.kind === "drive") return ok(`${root.letter}:\\${body(parsed, "\\")}`, to);
    if (root.kind === "unc") {
      const rest = body(parsed, "\\");
      return ok(`\\\\${root.host}\\${root.share}${rest === "" ? "" : `\\${rest}`}`, to);
    }
    if (root.kind === "relative") return ok(relativeBody(parsed, "\\"), to);
    return refuse("no-drive");
  }

  if (to === "unix" || to === "wsl") {
    if (root.kind === "posix") return ok(`/${body(parsed, "/")}`, to);
    if (root.kind === "relative") return ok(relativeBody(parsed, "/"), to);
    if (root.kind === "drive") {
      // A drive letter is not a directory. WSL publishes one at /mnt/<letter>;
      // plain POSIX has no such place, and answering `/c/…` would name nothing.
      if (to === "unix") return refuse("no-unix-root");
      const rest = body(parsed, "/");
      return ok(`/mnt/${root.letter.toLowerCase()}${rest === "" ? "" : `/${rest}`}`, to);
    }
    return refuse("no-unix-root");
  }

  if (to === "unc") {
    if (root.kind !== "unc") return refuse("no-host");
    const rest = body(parsed, "\\");
    return ok(`\\\\${root.host}\\${root.share}${rest === "" ? "" : `\\${rest}`}`, to);
  }

  if (root.kind === "relative") return refuse("not-absolute");
  const encoded = encodeSegments(parsed.segments);
  const tail = parsed.trailingSeparator && parsed.segments.length > 0 ? "/" : "";
  if (root.kind === "drive") return ok(`file:///${root.letter}:/${encoded}${tail}`, to);
  if (root.kind === "unc") {
    const rest = encoded === "" ? "" : `/${encoded}`;
    return ok(`file://${root.host}/${encodeURIComponent(root.share)}${rest}${tail}`, to);
  }
  return ok(`file:///${encoded}${tail}`, to);
}

/** Read `text` in whatever flavour it is written in and write it back in `to`. */
export function convertPath(text: string, to: PathFlavour): PathResult {
  const outcome = readPath(text);
  return outcome.ok ? formatPath(outcome.path, to) : outcome;
}

/** The three shells a path from this app is likely to be pasted into. */
export const PATH_SHELLS = ["powershell", "cmd", "posix"] as const;

export type PathShell = (typeof PATH_SHELLS)[number];

/**
 * Characters that make a shell do something other than pass the path along:
 * whitespace, the quoting characters themselves, and the expansion, redirection
 * and globbing operators. Letters with diacritics are deliberately NOT in here —
 * no shell treats „Đorđe" specially, and quoting it would only make the answer
 * uglier than the question.
 */
const SHELL_SPECIAL = /[\s"'`$&|;<>()*?[\]{}!%^]/;

/** Whether pasting this path unquoted would change what a shell does with it. */
export function pathNeedsQuoting(path: string): boolean {
  return SHELL_SPECIAL.test(path);
}

/**
 * Whether `cmd.exe` would read a substitution out of this path instead of
 * passing it along — the one thing `quotePath(…, "cmd")` cannot neutralise, and
 * therefore the one thing a surface offering a cmd path has to say out loud.
 *
 * **Any `%` at all, not only a `%NAME%` pair.** Every context cmd parses in
 * treats a bare one as syntax, and differently: a batch file expands `%1`…`%9`
 * as its arguments and DROPS a `%` that begins no construct at all, while the
 * interactive prompt leaves an unset `%NAME%` standing and expands a set one.
 * Whether a given percent survives therefore depends on the environment and on
 * where the text is pasted, neither of which this module can see. „This path is
 * not literal to cmd" is the only claim that is true in all of them.
 */
export function cmdExpandsPath(path: string): boolean {
  return path.includes("%");
}

/**
 * `path`, quoted for `shell` when it needs it and returned untouched when it
 * does not.
 *
 * Single quotes for the two shells that have a literal quoting form, because
 * inside them nothing expands — a double-quoted `$HOME` in a filename would
 * otherwise be substituted away. `cmd` has only double quotes and no escape at
 * all for a `"` inside them; that is not a gap here, because Windows forbids `"`
 * in a filename, so the character cannot appear in a path this function is
 * given.
 *
 * **The `cmd` answer is not safe to paste when the path contains `%`, and this
 * function cannot make it safe.** `cmd.exe` substitutes variables during
 * tokenisation, BEFORE quotes are stripped, so `"C:\%TEMP%\build"` expands
 * exactly as the bare text does and the quoting is a no-op for that character.
 * Nor is there an escape to reach for: `^%` is literal at the interactive prompt
 * but not inside quotes, `%%` is literal in a batch file but not at the prompt,
 * and inside a `for` body the rules change again — so any escape written here
 * would be correct in one context and silently wrong in the others, which is the
 * failure this module exists to avoid. The quoted text is returned, because it
 * is still the right answer for the space in `Program Files`, and
 * `cmdExpandsPath` states checkably that the result is not literal.
 */
export function quotePath(path: string, shell: PathShell): string {
  if (!pathNeedsQuoting(path)) return path;
  if (shell === "cmd") return `"${path}"`;
  if (shell === "powershell") return `'${path.replaceAll("'", "''")}'`;
  return `'${path.replaceAll("'", `'\\''`)}'`;
}

/* -------------------------------------------------------------------- cidr */

export const IP_FAMILIES = ["ipv4", "ipv6"] as const;

export type IpFamily = (typeof IP_FAMILIES)[number];

/** Address width. IPv6 needs `bigint` throughout: 2^128 is not a double, and 2^64 already is not an integer one. */
const IP_BITS: Readonly<Record<IpFamily, number>> = { ipv4: 32, ipv6: 128 };

export interface IpAddress {
  readonly family: IpFamily;
  readonly value: bigint;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_GROUP = /^[0-9A-Fa-f]{1,4}$/;

/**
 * A dotted quad, refusing two things a permissive parser accepts.
 *
 * **A leading zero is refused.** `010` is eight to anything that reads it as C
 * does and ten to anything that reads it as decimal, so `192.168.010.1` is two
 * different addresses depending on who resolves it. That difference is the
 * mechanism behind a long line of access-control bypasses, and choosing one
 * reading here would make this tool the thing that told somebody the wrong one.
 *
 * **A short form is refused.** `10.1` means `10.0.0.1` to `inet_aton` and
 * nothing at all to most modern parsers; a reference tool answers the question
 * that was asked or says it cannot.
 */
function parseIpv4(text: string): bigint | null {
  const match = IPV4.exec(text);
  if (match === null) return null;
  let value = 0n;
  for (let i = 1; i <= 4; i += 1) {
    const part = match[i];
    if (part === undefined) return null;
    if (part.length > 1 && part.startsWith("0")) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

/** A trailing dotted quad standing in for the last two groups (RFC 4291 §2.2 form 3), expanded to hex. */
function expandEmbeddedIpv4(tokens: readonly string[]): readonly string[] | null {
  const last = tokens[tokens.length - 1];
  if (last === undefined || !last.includes(".")) return tokens;
  const value = parseIpv4(last);
  if (value === null) return null;
  return [
    ...tokens.slice(0, -1),
    Number((value >> 16n) & 0xffffn).toString(16),
    Number(value & 0xffffn).toString(16),
  ];
}

function groupsToValue(groups: readonly string[]): bigint | null {
  let value = 0n;
  for (const group of groups) {
    if (!IPV6_GROUP.test(group)) return null;
    value = (value << 16n) | BigInt(`0x${group}`);
  }
  return value;
}

/**
 * RFC 4291 §2.2, all three forms. A zone identifier (`fe80::1%eth0`) is refused
 * rather than stripped: the zone is what makes a link-local address resolvable,
 * so dropping it produces an address that looks usable and is not.
 */
function parseIpv6(text: string): bigint | null {
  if (text.includes("%")) return null;

  const doubleColon = text.indexOf("::");
  if (doubleColon !== text.lastIndexOf("::")) return null;

  const headText = doubleColon === -1 ? text : text.slice(0, doubleColon);
  const tailText = doubleColon === -1 ? "" : text.slice(doubleColon + 2);
  const rawHead = headText === "" ? [] : headText.split(":");
  const rawTail = tailText === "" ? [] : tailText.split(":");

  // The embedded IPv4 can only be the final token overall — expanding it
  // anywhere else would accept `1.2.3.4::1`, which is not an address.
  const head = doubleColon === -1 && rawTail.length === 0 ? expandEmbeddedIpv4(rawHead) : rawHead;
  const tail = rawTail.length === 0 ? rawTail : expandEmbeddedIpv4(rawTail);
  if (head === null || tail === null) return null;

  const total = head.length + tail.length;
  // Without `::` all eight groups must be written; with it, at least one group
  // must be left for `::` to stand for — `1:2:3:4:5:6:7:8::` is not an address.
  if (doubleColon === -1 ? total !== 8 : total > 7) return null;

  const headValue = groupsToValue(head);
  const tailValue = groupsToValue(tail);
  if (headValue === null || tailValue === null) return null;

  // The head sits at the top of the 128 bits and the tail at the bottom; the
  // gap between them is the run of zeros `::` stands for, which needs no term
  // at all because it is zero.
  return (headValue << BigInt(128 - head.length * 16)) | tailValue;
}

/** An address of either family, decided by whether a colon is present. */
export function parseIp(text: string): IpAddress | null {
  const body = text.trim();
  if (body === "") return null;
  if (body.includes(":")) {
    const value = parseIpv6(body);
    return value === null ? null : { family: "ipv6", value };
  }
  const value = parseIpv4(body);
  return value === null ? null : { family: "ipv4", value };
}

function formatIpv4(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => Number((value >> shift) & 0xffn)).join(".");
}

/**
 * RFC 5952 §4, all four rules: leading zeros suppressed (§4.1), `::` never used
 * for a single zero group (§4.2.1), `::` always used on the LONGEST zero run
 * (§4.2.2) and on the FIRST of equal runs (§4.2.3), lowercase hex (§4.3).
 *
 * **§5's mixed notation is deliberately not produced.** The section says an
 * address with an embedded IPv4 „can be represented" in the dotted form — it
 * permits, it does not require — and producing it unconditionally would print
 * `::ffff:0:0` as `::ffff:0.0.0.0`, spelling one address two ways depending on a
 * judgement about intent that a formatter cannot make. The PARSER accepts the
 * mixed form, so nothing a user can type is refused; only the canonical output
 * is single-formed.
 */
function formatIpv6(value: bigint): string {
  const groups: number[] = [];
  for (let i = 7; i >= 0; i -= 1) groups.push(Number((value >> BigInt(i * 16)) & 0xffffn));

  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;
  let runLength = 0;
  for (let i = 0; i < 8; i += 1) {
    if (groups[i] === 0) {
      if (runStart === -1) runStart = i;
      runLength += 1;
      // Strictly greater, so the FIRST of two equal runs wins (§4.2.3).
      if (runLength > bestLength) {
        bestLength = runLength;
        bestStart = runStart;
      }
    } else {
      runStart = -1;
      runLength = 0;
    }
  }

  const text = groups.map((group) => group.toString(16));
  if (bestLength < 2) return text.join(":");
  return `${text.slice(0, bestStart).join(":")}::${text.slice(bestStart + bestLength).join(":")}`;
}

/** The canonical spelling of an address: dotted quad for v4, RFC 5952 short form for v6. */
export function formatIp(address: IpAddress): string {
  return address.family === "ipv4" ? formatIpv4(address.value) : formatIpv6(address.value);
}

/** An address together with the prefix it was written with — the host bits are NOT cleared. */
export interface CidrInput {
  readonly address: IpAddress;
  readonly prefix: number;
}

const PREFIX_TEXT = /^(0|[1-9]\d*)$/;

/**
 * `address/prefix`, and nothing shorter.
 *
 * A bare address without a slash is REFUSED rather than treated as `/32`. This
 * parser's whole output is a statement about a block, and `10.0.0.1` alone is
 * a statement about a host — reading one as the other is how a rule meant for
 * one machine ends up applied to sixteen million. `parseIp` is the function for
 * an address on its own.
 */
export function parseCidr(text: string): CidrInput | null {
  const parts = text.trim().split("/");
  if (parts.length !== 2) return null;
  const [addressText = "", prefixText = ""] = parts;
  if (!PREFIX_TEXT.test(prefixText)) return null;

  const address = parseIp(addressText);
  if (address === null) return null;

  const prefix = Number(prefixText);
  if (prefix > IP_BITS[address.family]) return null;
  return { address, prefix };
}

/** A list of blocks written one per line, comma-separated or space-separated. All must parse, or none is returned. */
export function parseCidrList(text: string): readonly CidrBlock[] | null {
  const tokens = text.split(/[\s,]+/).filter((token) => token !== "");
  if (tokens.length === 0) return null;
  const blocks: CidrBlock[] = [];
  for (const token of tokens) {
    const input = parseCidr(token);
    if (input === null) return null;
    blocks.push(cidrBlockOf(input));
  }
  return blocks;
}

export interface CidrBlock {
  readonly family: IpFamily;
  /** Host bits already cleared — a block, unlike a `CidrInput`, has no host part to remember. */
  readonly network: bigint;
  readonly prefix: number;
}

function maskFor(family: IpFamily, prefix: number): bigint {
  const bits = BigInt(IP_BITS[family]);
  const kept = BigInt(prefix);
  return kept === 0n ? 0n : ((1n << kept) - 1n) << (bits - kept);
}

/** The block an address-and-prefix falls in — the host bits dropped, deliberately and once. */
export function cidrBlockOf(input: CidrInput): CidrBlock {
  const family = input.address.family;
  return {
    family,
    network: input.address.value & maskFor(family, input.prefix),
    prefix: input.prefix,
  };
}

export function formatCidr(block: CidrBlock): string {
  return `${formatIp({ family: block.family, value: block.network })}/${block.prefix}`;
}

/** Whether `address` falls inside `block`. A different family is not „outside", it is unanswerable — and answers `false`. */
export function cidrContains(block: CidrBlock, address: IpAddress): boolean {
  if (address.family !== block.family) return false;
  return (address.value & maskFor(block.family, block.prefix)) === block.network;
}

export interface CidrReport {
  readonly family: IpFamily;
  /** The address as it was given, canonicalised — NOT the network address, which is the field below. */
  readonly address: string;
  readonly prefix: number;
  readonly network: string;
  /**
   * The all-ones host address. `null` for IPv6, which has no broadcast at all,
   * and for IPv4 `/31` and `/32`: a point-to-point link (RFC 3021) and a single
   * host have no hosts to broadcast to, and printing the last address under that
   * name would be naming something that does not exist.
   */
  readonly broadcast: string | null;
  readonly firstHost: string;
  readonly lastHost: string;
  readonly total: bigint;
  /**
   * Addresses usable by a host. IPv4 loses the network and broadcast addresses
   * except on `/31`, where RFC 3021 assigns BOTH to the two ends, and on `/32`,
   * which is the one host. IPv6 loses none — it has no broadcast, and the
   * subnet-router anycast address at the bottom of a prefix is a convention of
   * the link, not a hole in the arithmetic.
   */
  readonly usable: bigint;
  readonly netmask: string;
  readonly wildcard: string;
}

export function describeCidr(input: CidrInput): CidrReport {
  const family = input.address.family;
  const bits = IP_BITS[family];
  const mask = maskFor(family, input.prefix);
  const full = (1n << BigInt(bits)) - 1n;
  const network = input.address.value & mask;
  const last = network | (full ^ mask);
  const total = 1n << BigInt(bits - input.prefix);
  const show = (value: bigint): string => formatIp({ family, value });

  const hasBroadcast = family === "ipv4" && input.prefix <= 30;
  const firstHost = hasBroadcast ? network + 1n : network;
  const lastHost = hasBroadcast ? last - 1n : last;
  const usable = family === "ipv4" && hasBroadcast ? total - 2n : total;

  return {
    family,
    address: show(input.address.value),
    prefix: input.prefix,
    network: show(network),
    broadcast: hasBroadcast ? show(last) : null,
    firstHost: show(firstHost),
    lastHost: show(lastHost),
    total,
    usable,
    netmask: show(mask),
    wildcard: show(full ^ mask),
  };
}

/** Above this a split is a denial of service on the surface asking for it, not a table anyone reads. */
const MAX_SUBNETS = 4096;

/**
 * `block` cut into `parts` EQUAL subnets.
 *
 * `parts` must be a power of two, and that is not an implementation
 * convenience: a prefix halves the block at every step, so three equal subnets
 * of a `/24` do not exist. Asking for them gets a refusal rather than four
 * subnets of which one is quietly left over.
 */
export function splitCidr(block: CidrBlock, parts: number): readonly CidrBlock[] | null {
  if (!Number.isInteger(parts) || parts < 1 || parts > MAX_SUBNETS) return null;
  if ((parts & (parts - 1)) !== 0) return null;

  const added = Math.log2(parts);
  const prefix = block.prefix + added;
  if (prefix > IP_BITS[block.family]) return null;

  const step = 1n << BigInt(IP_BITS[block.family] - prefix);
  const out: CidrBlock[] = [];
  for (let i = 0; i < parts; i += 1) {
    out.push({ family: block.family, network: block.network + BigInt(i) * step, prefix });
  }
  return out;
}

/**
 * The smallest single block that covers every one of `blocks`.
 *
 * The answer is found from the two extremes and the bit where they first differ:
 * everything above that bit is shared by every address in between, so it is the
 * longest prefix that can contain them all. Mixed families have no common
 * supernet — there is no address space both live in — and that is a refusal, not
 * a `0.0.0.0/0`.
 */
export function summariseCidrs(blocks: readonly CidrBlock[]): CidrBlock | null {
  const first = blocks[0];
  if (first === undefined) return null;
  const family = first.family;
  if (blocks.some((block) => block.family !== family)) return null;

  const bits = IP_BITS[family];
  const full = (1n << BigInt(bits)) - 1n;
  let low = full;
  let high = 0n;
  for (const block of blocks) {
    const mask = maskFor(family, block.prefix);
    const last = block.network | (full ^ mask);
    if (block.network < low) low = block.network;
    if (last > high) high = last;
  }

  let prefix = bits;
  while (prefix > 0 && (low & maskFor(family, prefix)) !== (high & maskFor(family, prefix))) {
    prefix -= 1;
  }
  return { family, network: low & maskFor(family, prefix), prefix };
}

/* ------------------------------------------------------------------ semver */

export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** Dot-separated identifiers, exactly as written. Empty for a release. */
  readonly prerelease: readonly string[];
  /** Dot-separated identifiers. Carried so a version can be printed back, and ignored by every comparison. */
  readonly build: readonly string[];
}

/**
 * The official regular expression published on semver.org (SemVer 2.0.0, the
 * „Is there a suggested regular expression to check a SemVer string?" FAQ
 * entry), transcribed rather than re-derived. It is the reason `1.02.3` and
 * `1.2.3-01` are refused: a numeric identifier must not carry a leading zero,
 * which is the rule that makes numeric comparison well defined.
 */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * A version, or `null`.
 *
 * A leading `v` or `=` is accepted, because that is how versions arrive — from a
 * git tag, from a changelog line, from `npm ls`. semver.org is explicit that
 * `v1.2.3` is not itself a semantic version but that the prefix is a common way
 * of writing one, and this is the one asymmetry in the module: `formatSemver`
 * never writes the prefix back, so `format(parse("v1.2.3"))` is `"1.2.3"`. The
 * text changes; the version does not.
 */
export function parseSemver(text: string): SemVer | null {
  const body = text.trim().replace(/^[v=]\s*/, "");
  const match = SEMVER.exec(body);
  if (match === null) return null;
  const [, major = "", minor = "", patch = "", prerelease, build] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease === undefined ? [] : prerelease.split("."),
    build: build === undefined ? [] : build.split("."),
  };
}

/** The canonical spelling. Exactly `parseSemver`'s language, so a parsed version round-trips. */
export function formatSemver(version: SemVer): string {
  const core = `${version.major}.${version.minor}.${version.patch}`;
  const pre = version.prerelease.length === 0 ? "" : `-${version.prerelease.join(".")}`;
  const build = version.build.length === 0 ? "" : `+${version.build.join(".")}`;
  return `${core}${pre}${build}`;
}

const NUMERIC_IDENTIFIER = /^\d+$/;

function sign(value: bigint): -1 | 0 | 1 {
  return value < 0n ? -1 : value > 0n ? 1 : 0;
}

/**
 * SemVer 2.0.0 §11.4, the three sub-rules in order: two numeric identifiers
 * compare numerically, two alphanumeric ones compare in ASCII order, and a
 * numeric identifier is always LOWER than an alphanumeric one.
 *
 * `BigInt` rather than `Number` for the numeric case because the grammar puts no
 * ceiling on a numeric identifier's length, and a build pipeline that stamps a
 * commit epoch or a monotonic counter into the prerelease can put more than
 * fifteen digits there — at which point two different identifiers would compare
 * equal as doubles.
 */
function compareIdentifier(left: string, right: string): -1 | 0 | 1 {
  const leftNumeric = NUMERIC_IDENTIFIER.test(left);
  const rightNumeric = NUMERIC_IDENTIFIER.test(right);
  if (leftNumeric && rightNumeric) return sign(BigInt(left) - BigInt(right));
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  // Over the identifier alphabet (`-`, digits, letters) UTF-16 order and ASCII
  // order are the same, so the built-in string comparison IS the spec's rule.
  return left < right ? -1 : left > right ? 1 : 0;
}

/** §11.3 and §11.4: a prerelease sorts BEFORE its release, and a longer identifier list sorts after a prefix of itself. */
function comparePrerelease(left: readonly string[], right: readonly string[]): -1 | 0 | 1 {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const a = left[i];
    const b = right[i];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const result = compareIdentifier(a, b);
    if (result !== 0) return result;
  }
  return 0;
}

/**
 * Precedence, per SemVer 2.0.0 §11. **Build metadata is not compared** (§10):
 * `1.0.0+build.1` and `1.0.0+build.2` are the same version by precedence, and a
 * sort that separated them would be inventing an order the spec says does not
 * exist.
 */
export function compareSemver(left: SemVer, right: SemVer): -1 | 0 | 1 {
  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
  return comparePrerelease(left.prerelease, right.prerelease);
}

/**
 * Ascending by precedence, in a NEW array. Versions that differ only in build
 * metadata compare equal and therefore keep their input order — `Array#sort` is
 * specified stable, so „equal by precedence" means „left where you put them"
 * rather than „shuffled".
 */
export function sortSemvers(versions: readonly SemVer[]): readonly SemVer[] {
  return [...versions].sort(compareSemver);
}

export type SemverOperator = "<" | "<=" | ">" | ">=" | "=";

export interface SemverComparator {
  readonly operator: SemverOperator;
  readonly version: SemVer;
}

/**
 * A range is an OR of ANDs — npm's grammar, where `||` separates alternatives
 * and whitespace joins comparators that must all hold. Every sugar (`^`, `~`,
 * `x`, a hyphen range) is desugared into this shape at parse time, so
 * `satisfiesSemver` has exactly one thing to evaluate.
 */
export type SemverRange = readonly (readonly SemverComparator[])[];

const ZERO: SemVer = { major: 0, minor: 0, patch: 0, prerelease: [], build: [] };

/** A version with a wildcard in it. `null` in a position means „any", and a wildcard makes everything after it one too. */
interface PartialVersion {
  readonly major: number | null;
  readonly minor: number | null;
  readonly patch: number | null;
  readonly prerelease: readonly string[];
}

const XRANGE =
  /^[v=]?(0|[1-9]\d*|[xX*])(?:\.(0|[1-9]\d*|[xX*]))?(?:\.(0|[1-9]\d*|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function readPartial(text: string): PartialVersion | null {
  if (text === "" || text === "*" || text === "x" || text === "X") {
    return { major: null, minor: null, patch: null, prerelease: [] };
  }
  const match = XRANGE.exec(text);
  if (match === null) return null;

  const asNumber = (part: string | undefined): number | null =>
    part === undefined || part === "x" || part === "X" || part === "*" ? null : Number(part);

  const major = asNumber(match[1]);
  // A wildcard swallows everything to its right: `1.x.3` is `1.x`, because
  // there is no such thing as „any minor, but patch 3".
  const minor = major === null ? null : asNumber(match[2]);
  const patch = minor === null ? null : asNumber(match[3]);
  const prerelease = match[4];

  if (prerelease !== undefined) {
    // A prerelease pins one exact release, so it cannot sit on a wildcard, and
    // it must satisfy the strict grammar rather than the looser range one.
    if (patch === null) return null;
    if (parseSemver(`${major}.${minor}.${patch}-${prerelease}`) === null) return null;
    return { major, minor, patch, prerelease: prerelease.split(".") };
  }
  return { major, minor, patch, prerelease: [] };
}

function version(
  major: number,
  minor: number,
  patch: number,
  prerelease: readonly string[] = [],
): SemVer {
  return { major, minor, patch, prerelease, build: [] };
}

/** The bottom of the region a partial version names: every wildcard read as zero. */
function lowerBound(partial: PartialVersion): SemVer {
  return version(partial.major ?? 0, partial.minor ?? 0, partial.patch ?? 0, partial.prerelease);
}

/** The first version PAST the region a partial names, or `null` when it has no wildcard to bound. */
function upperBound(partial: PartialVersion): SemVer | null {
  if (partial.major === null) return null;
  if (partial.minor === null) return version(partial.major + 1, 0, 0);
  if (partial.patch === null) return version(partial.major, partial.minor + 1, 0);
  return null;
}

/** A range that admits nothing — what `>*` and `<*` mean, said in the same grammar as everything else. */
const MATCHES_NOTHING: readonly SemverComparator[] = [{ operator: "<", version: ZERO }];

/**
 * `^`: everything up to the next change that is allowed to break you. Above
 * 0.x that is the major; at 0.x the minor carries the same weight, and at 0.0.x
 * so does the patch — semver's own advice is that 0.y.z makes no compatibility
 * promise at all, and npm's caret encodes exactly that reading.
 */
function caretBounds(partial: PartialVersion): SemVer | null {
  const major = partial.major;
  if (major === null) return null;
  if (major > 0) return version(major + 1, 0, 0);
  if (partial.minor === null) return version(1, 0, 0);
  if (partial.minor > 0) return version(0, partial.minor + 1, 0);
  if (partial.patch === null) return version(0, 1, 0);
  return version(0, 0, partial.patch + 1);
}

/** `~`: patch-level changes when a minor is given, minor-level when it is not. */
function tildeBounds(partial: PartialVersion): SemVer | null {
  const major = partial.major;
  if (major === null) return null;
  if (partial.minor === null) return version(major + 1, 0, 0);
  return version(major, partial.minor + 1, 0);
}

const COMPARATOR = /^(<=|>=|<|>|=|\^|~)?(.*)$/;

function desugar(token: string): readonly SemverComparator[] | null {
  const match = COMPARATOR.exec(token);
  if (match === null) return null;
  const operator = match[1] ?? "";
  const partial = readPartial(match[2] ?? "");
  if (partial === null) return null;

  const low = lowerBound(partial);
  const exact = partial.patch !== null;
  const upper = upperBound(partial);

  if (operator === "^" || operator === "~") {
    const bound = operator === "^" ? caretBounds(partial) : tildeBounds(partial);
    if (bound === null) return [{ operator: ">=", version: ZERO }];
    return [
      { operator: ">=", version: low },
      { operator: "<", version: bound },
    ];
  }

  if (operator === "" || operator === "=") {
    if (exact) return [{ operator: "=", version: low }];
    if (upper === null) return [{ operator: ">=", version: ZERO }];
    return [
      { operator: ">=", version: low },
      { operator: "<", version: upper },
    ];
  }

  if (operator === ">=") return [{ operator: ">=", version: low }];
  if (operator === ">") {
    if (exact) return [{ operator: ">", version: low }];
    if (upper === null) return MATCHES_NOTHING;
    // `>1.2.x` means „past everything 1.2 covers", which starts at 1.3.0.
    return [{ operator: ">=", version: upper }];
  }
  if (operator === "<=") {
    if (exact) return [{ operator: "<=", version: low }];
    if (upper === null) return MATCHES_NOTHING;
    return [{ operator: "<", version: upper }];
  }
  if (exact) return [{ operator: "<", version: low }];
  if (upper === null) return MATCHES_NOTHING;
  return [{ operator: "<", version: low }];
}

/** `A - B`: inclusive at both ends, except that a partial `B` extends to the end of what it names. */
function hyphenRange(left: string, right: string): readonly SemverComparator[] | null {
  const from = readPartial(left);
  const to = readPartial(right);
  if (from === null || to === null) return null;

  const lower: SemverComparator = { operator: ">=", version: lowerBound(from) };
  if (to.major === null) return [lower];
  if (to.patch !== null) return [lower, { operator: "<=", version: lowerBound(to) }];
  const upper = upperBound(to);
  return upper === null ? [lower] : [lower, { operator: "<", version: upper }];
}

/** Collapses `>= 1.2.3` to `>=1.2.3` so the set can then be split on whitespace. */
const OPERATOR_SPACE = /(<=|>=|<|>|=|\^|~)\s+/g;

function parseComparatorSet(text: string): readonly SemverComparator[] | null {
  const trimmed = text.trim().replace(OPERATOR_SPACE, "$1");
  if (trimmed === "") return [{ operator: ">=", version: ZERO }];

  // A hyphen range is spaced (`1.2.3 - 2.0.0`); the hyphen inside a prerelease
  // never is, so this split cannot cut `1.2.3-alpha` in half.
  const hyphen = trimmed.split(/\s+-\s+/);
  if (hyphen.length === 2) return hyphenRange(hyphen[0] ?? "", hyphen[1] ?? "");
  if (hyphen.length > 2) return null;

  const out: SemverComparator[] = [];
  for (const token of trimmed.split(/\s+/)) {
    const part = desugar(token);
    if (part === null) return null;
    out.push(...part);
  }
  return out;
}

/** A range, or `null` when any part of it is not one. One bad comparator refuses the whole range. */
export function parseSemverRange(text: string): SemverRange | null {
  const sets: (readonly SemverComparator[])[] = [];
  for (const alternative of text.split("||")) {
    const set = parseComparatorSet(alternative);
    if (set === null) return null;
    sets.push(set);
  }
  return sets;
}

function testComparator(candidate: SemVer, comparator: SemverComparator): boolean {
  const result = compareSemver(candidate, comparator.version);
  switch (comparator.operator) {
    case "<":
      return result < 0;
    case "<=":
      return result <= 0;
    case ">":
      return result > 0;
    case ">=":
      return result >= 0;
    default:
      return result === 0;
  }
}

/**
 * Whether `candidate` satisfies `range`.
 *
 * **A prerelease only ever satisfies a range that asked for one on its own
 * version.** Without that rule `^1.2.3` would match `2.0.0-alpha`, because
 * `2.0.0-alpha` really does sort below `2.0.0` — and a caret range would then
 * quietly pull in the next major's untested builds, which is the single most
 * damaging thing a version range can do. So a candidate with a prerelease must
 * find, in the same AND-set, a comparator whose own version carries a
 * prerelease on the identical major.minor.patch. This is node-semver's default
 * behaviour (`includePrerelease: false`) and it is the behaviour every
 * `package.json` in the wild was written against.
 */
export function satisfiesSemver(candidate: SemVer, range: SemverRange): boolean {
  return range.some((set) => {
    if (!set.every((comparator) => testComparator(candidate, comparator))) return false;
    if (candidate.prerelease.length === 0) return true;
    return set.some(
      (comparator) =>
        comparator.version.prerelease.length > 0 &&
        comparator.version.major === candidate.major &&
        comparator.version.minor === candidate.minor &&
        comparator.version.patch === candidate.patch,
    );
  });
}

/** The highest version in `versions` that satisfies `range`, or `null` when none does. */
export function maxSatisfyingSemver(
  versions: readonly SemVer[],
  range: SemverRange,
): SemVer | null {
  let best: SemVer | null = null;
  for (const candidate of versions) {
    if (!satisfiesSemver(candidate, range)) continue;
    if (best === null || compareSemver(candidate, best) > 0) best = candidate;
  }
  return best;
}
