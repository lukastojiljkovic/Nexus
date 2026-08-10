/**
 * „Programerske alatke" — the drawer's Serbian copy, composed from one file per
 * category.
 *
 * **Why this is not simply another group in `strings.sr.ts`.** Forty-eight
 * tools carry more copy than the eleven modules above them put together: field
 * labels, hints, table headings and one refusal per surface. Written inline it
 * would be a fifth of that file and would bury every other module's strings in
 * the scroll. The split is by CATEGORY, which is also how the drawer groups its
 * rail, so „where does this label live" has the same answer as „where does this
 * tool live".
 *
 * Nothing here is a second copy layer. This is one leaf of the same table —
 * `strings.sr.ts` spreads it in as `devtools`, `strings.ts` clones the whole
 * thing, and the locale switch rewrites these leaves exactly as it rewrites the
 * rest. A consumer still reads `strings.devtools.…` and never imports this file.
 */
import { DEVTOOLS_NUMBERS_SR } from "./devtools.numbers.js";
import { DEVTOOLS_RISCV_SR } from "./devtools.riscv.js";
import { DEVTOOLS_ENCODING_SR } from "./devtools.encoding.js";
import { DEVTOOLS_DATA_SR } from "./devtools.data.js";
import { DEVTOOLS_TEXT_SR } from "./devtools.text.js";
import { DEVTOOLS_DESIGN_SR } from "./devtools.design.js";
import { DEVTOOLS_CRYPTO_SR } from "./devtools.crypto.js";
import { DEVTOOLS_SYSTEM_SR } from "./devtools.system.js";
import { DEVTOOLS_TIME_SR } from "./devtools.time.js";

export const devtoolsSr = {
  title: "Programerske alatke",
  searchLabel: "Pretraži programerske alatke",
  searchPlaceholder: "Pretraži po imenu ili pojmu…",
  noMatches: "Nijedna alatka ne odgovara pretrazi.",
  clearSearch: "Poništi pretragu",
  emptyTitle: "Nijedna alatka nije otvorena",
  /** Says how to find one, because with forty-eight tools the list is the hard part. */
  empty: "Izaberi alatku sa liste ili je pronađi pretragom.",
  /**
   * Copy the surfaces share — the words that would otherwise be written
   * forty-eight times and drift on about six of them.
   */
  common: {
    copy: "Kopiraj",
    /** Replaces „Kopiraj" for a moment after a copy. Past tense: it has happened. */
    copied: "Kopirano",
    result: "Rezultat",
    input: "Ulaz",
    output: "Izlaz",
    /** Before anything has been typed — the output box says this instead of standing empty. */
    awaitingInput: "Upiši nešto gore.",
    /** The one refusal every surface can need: the text is not what this tool reads. */
    invalid: "Ovo nije oblik koji ova alatka čita.",
    bytes: "Bajtova",
    characters: "Znakova",
    lines: "Redova",
    /** Under a table that stopped early — a table that stops silently misreports its input. */
    tableCapped: "U tabeli je prvih {shown} od {total} redova.",
  },
  name: {
    "number-base": "Brojni sistemi",
    "integer-inspector": "Inspektor celih brojeva",
    bitwise: "Bitske operacije",
    "data-unit": "Jedinice podataka",
    "float-convert": "Brojevi u pokretnom zarezu",
    "mx-block": "Mikroskalirani blokovi",
    riscv: "RISC-V instrukcije",
    base64: "Base64",
    "url-encode": "URL kodiranje",
    "url-parse": "Delovi URL-a",
    "ascii-binary-hex": "Tekst u bajtove",
    "unicode-inspector": "Unicode inspektor",
    "html-entities": "HTML entiteti",
    hexdump: "Hexdump",
    "json-editor": "JSON alat",
    "yaml-editor": "YAML alat",
    "xml-editor": "XML alat",
    "data-format": "Konverzija formata",
    "json-to-types": "JSON u tipove",
    uuid: "Identifikatori",
    diff: "Poređenje teksta",
    "markdown-table": "Markdown tabela",
    lorem: "Tekst za popunu",
    slug: "Slug",
    "case-convert": "Oblik zapisa",
    "line-tools": "Alati za redove",
    regex: "Regularni izrazi",
    "color-convert": "Pretvarač boja",
    "color-palette": "Paleta boja",
    gradient: "Gradijent",
    "cubic-bezier": "Bezijeova kriva",
    contrast: "Kontrast",
    "color-mixer": "Mešanje boja",
    "token-gen": "Generator tokena",
    "password-gen": "Generator lozinki",
    jwt: "JWT",
    hashing: "Heš i HMAC",
    aes: "AES",
    "rsa-keygen": "RSA ključevi",
    "rsa-crypt": "RSA šifrovanje",
    signature: "Digitalni potpis",
    "http-status": "HTTP kodovi",
    "path-convert": "Putanje",
    cidr: "IP i CIDR",
    semver: "Semantičke verzije",
    qr: "QR kod",
    datetime: "Vreme i datum",
    cron: "Cron izraz",
  },
  blurb: {
    "number-base": "Pretvara ceo broj između osnova od 2 do 36, bez gubitka i jednog bita.",
    "integer-inspector": "Isti broj kao int8/16/32/64 i uint8/16/32/64 — sa dvojnim komplementom, opsegom i redosledom bajtova.",
    bitwise: "AND, OR, XOR, negacije, pomeraji i rotacije na 8, 16, 32 ili 64 bita.",
    "data-unit": "Bajtovi i bitovi kroz decimalne (1000) i binarne (1024) jedinice — bez mešanja kB i KiB.",
    "float-convert": "Isti broj kroz fp64, fp32, tf32, bf16, fp16, fp8 (e5m2/e4m3, i fnuz), mxfp6, mxfp4 i e8m0 — bit po bit, tačno.",
    "mx-block": "OCP MX blok od 32 elementa: zajednički E8M0 eksponent, po element mxfp4/6/8, i koliko bita to zaista košta.",
    riscv: "Sastavlja i rastavlja RV32/RV64 instrukcije — I, M, A, Zicsr i sažeti C oblik, sa poljima bit po bit.",
    base64: "Kodiranje i dekodiranje Base64 — oba alfabeta, sa dopunom i bez nje.",
    "url-encode": "Tri različita procenat-kodiranja i zašto se razlikuju.",
    "url-parse": "Razlaže URL na šemu, host, port, putanju, parametre i fragment.",
    "ascii-binary-hex": "Tekst kao kodne tačke, heks bajtovi, binarni bajtovi i znakovi — i nazad.",
    "unicode-inspector": "Svaka kodna tačka, njeni bajtovi i kategorija, plus četiri normalizacije.",
    "html-entities": "Kodiranje i dekodiranje entiteta, sa tabelom imenovanih zapisa.",
    hexdump: "Kanonski heks ispis sa ASCII kolonom, i čitanje ispisa nazad u bajtove.",
    "json-editor": "Formatiranje, provera i pretraga JSON-a — sa tačnim mestom greške.",
    "yaml-editor": "Čita i piše YAML, a ono što ne podržava odbija po imenu.",
    "xml-editor": "Uređuje XML i HTML, proverava ispravnost i pretražuje XPath-om.",
    "data-format": "Pretvara JSON, YAML, TOML i CSV jedan u drugi — i unapred kaže šta ne može da prenese.",
    "json-to-types": "Pretvara JSON uzorak u TypeScript tipove ili Zod šemu.",
    uuid: "Napravi UUID v4, v7 ili ULID i pročitaj šta piše u postojećem.",
    diff: "Uporedi dva teksta red po red ili reč po reč.",
    "markdown-table": "Pretvori tabelu u Markdown i pročitaj je nazad.",
    lorem: "Nasumičan tekst za makete, latinski ili srpski.",
    slug: "Naslov u URL oblik, iz ćirilice i iz naših slova.",
    "case-convert": "Prebaci naziv u camelCase, snake_case i osam drugih oblika.",
    "line-tools": "Sortiraj, očisti, numeriši i prelomi redove.",
    regex: "Testiraj šablon, vidi poklapanja i pripremi zamenu.",
    "color-convert": "Pretvara boju između hex, rgb, hsl, hwb, lab, lch, oklab i oklch zapisa.",
    "color-palette": "Pravi svetlije i tamnije nijanse i harmonije od jedne boje, u OKLCH prostoru.",
    gradient: "Sastavlja linearni, radijalni ili konusni gradijent i uzorkuje ga bez pregledača.",
    "cubic-bezier": "Računa CSS cubic-bezier krivu ublažavanja i crta je iz uzoraka.",
    contrast: "Meri kontrast para boja po WCAG 2.1 i po APCA Lc.",
    "color-mixer": "Meša boje po udelu u sRGB, linearnom RGB i Oklab prostoru, i preklapa ih po alfi.",
    "token-gen": "Nasumični tokeni u hex, base64url, base58 ili sopstvenoj azbuci.",
    "password-gen": "Lozinke po grupama znakova ili fraze iz rečnika, sa entropijom u bitima.",
    jwt: "Rastavlja token, imenuje tvrdnje i proverava potpis — alg: none nikad ne prolazi.",
    hashing: "SHA-1, SHA-256, SHA-384 i SHA-512 nad tekstom, sa HMAC-om i izlazom u hex i base64.",
    aes: "AES-GCM i AES-CBC sa direktnim ključem ili lozinkom preko PBKDF2, u koverti koja nosi IV.",
    "rsa-keygen": "Pravi RSA-OAEP ili RSA-PSS par na 2048, 3072 ili 4096 bita, kao PEM.",
    "rsa-crypt": "RSA-OAEP nad nalepljenim PEM ključem, sa jasno navedenom granicom dužine poruke.",
    signature: "Potpisuje i proverava preko RSA-PSS, RSASSA-PKCS1-v1_5 i ECDSA na P-256 i P-384.",
    "http-status": "Ceo registar HTTP statusa, sa objašnjenjem kada se koji šalje.",
    "path-convert": "Prevedi putanju između Windowsa, UNIX-a, WSL-a, UNC-a i file URL-a.",
    cidr: "Raščlani IPv4 ili IPv6 blok — mreža, opseg, maska i podmreže.",
    semver: "Uporedi verzije i proveri da li verzija upada u opseg.",
    qr: "Pravi QR kod od teksta, linka, Wi-Fi mreže ili kontakta.",
    datetime: "Jedan trenutak u svakom zapisu — Unix, ISO, RFC 2822, FILETIME i .NET tikovi.",
    cron: "Objašnjava crontab na srpskom i računa sledeća paljenja, sa pravim Vixie pravilom za dane.",
  },

  /* One group per category of the rail — see the header. */
  numbers: DEVTOOLS_NUMBERS_SR,
  riscv: DEVTOOLS_RISCV_SR,
  encoding: DEVTOOLS_ENCODING_SR,
  data: DEVTOOLS_DATA_SR,
  text: DEVTOOLS_TEXT_SR,
  design: DEVTOOLS_DESIGN_SR,
  crypto: DEVTOOLS_CRYPTO_SR,
  system: DEVTOOLS_SYSTEM_SR,
  time: DEVTOOLS_TIME_SR,
} as const;
