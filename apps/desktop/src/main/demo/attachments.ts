import { crc32, deflateSync } from "node:zlib";
import {
  NoteAttachmentStore,
  NoteStore,
  SubjectAttachmentStore,
  SubjectStore,
  TaskAttachmentStore,
  TaskStore,
} from "@nexus/db";
import { sniffMime } from "@nexus/core";
import { demoAt } from "./context.js";
import type { DatabaseHandle, DemoContext } from "./context.js";

/**
 * The files that hang off the demo profile's notes, tasks and subjects — the
 * demo slice of DOC, and the one every other slice leaves out.
 *
 * **Why one attachment on each owner kind is not a detail.** „Datoteke" is a
 * browse surface over the UNION of three tables (`note_attachments`,
 * `task_attachments`, `subject_attachments`), and a union of three empty
 * tables draws NOTHING: an empty read is the page's `EmptyState`, so the list,
 * the grid, the „Šta zauzima prostor" proportion bars and the owner/family
 * filter chips were all photographed as the same empty state in every size and
 * both themes — five surfaces of one page, none of them ever in a frame. The
 * same rows turn on the three panels that own them: a note's „Prilozi", a
 * task's „Prilozi", a subject's „Materijali".
 *
 * **The bytes are real, and they are built here rather than shipped.** A store
 * row is an INDEX row: the file itself lives in main's content-addressed,
 * encrypted blob store (`main/attachments.ts`), which is the one thing this
 * module cannot reach through the database — hence `DemoAttachmentIo`, injected
 * exactly the way `main/priv.ts` injects everything it needs, so this file runs
 * under plain Vitest with a Map standing in for the disk.
 *
 * **A fixture that is merely sniffable would be worse than no fixture at all.**
 * `sniffMime` reads magic bytes, so a PNG header with rubbish behind it seeds
 * perfectly and then photographs as a broken image in the grid (which fetches
 * `nx-blob://<sha256>` for exactly the rows whose mime is an image) — and
 * „Otvori" hands the OS a file whose extension its own bytes contradict. So
 * every fixture below is a structurally valid file of its type: a real PNG with
 * its CRCs and a real deflate stream, real PDFs with a computed xref, real
 * UTF-8 text. `seedDemoAttachments` then asserts the sniff BEFORE it writes the
 * row that quotes it, and a fixture that drifted fails the seed by name instead
 * of reaching a photograph.
 *
 * Built in code rather than committed as binary assets, for `minimalPdfBytes`'
 * own reason (`main/docPreview.ts`): a fixture the build cannot lose, that
 * typechecks, that a unit test can hold to the same sniff the real attachment
 * path applies, and that a reviewer reads as what it is.
 */

/**
 * The one thing the database cannot give this module: somewhere to put bytes.
 *
 * `saveBlob` answers with the PLAINTEXT SHA-256 of what it stored — the same
 * value the three attachment stores index a row by, and the value the grid's
 * `<img>` and the `nx-blob:` protocol both name. Main wires it to
 * `main/attachments.ts:saveBlob` over the unlocked session's blob keys, which
 * is what makes a demo file openable and previewable exactly like one a person
 * attached — and picked up by the same content-index backfill, once it runs.
 */
export interface DemoAttachmentIo {
  saveBlob(bytes: Uint8Array): Promise<string>;
}

/**
 * Which of the three PUBLIC attachment tables an owner lives in —
 * `AttachmentOwnerKind` read from the seeding side, where PRIV is not a case at
 * all: a sealed note keeps its files inside its envelope, in no table this
 * reaches.
 */
type OwnerKind = "note" | "task" | "subject";

interface DemoAttachmentSpec {
  readonly ownerKind: OwnerKind;
  /**
   * The owner's own title — a note's title, a task's title, a subject's NAME —
   * matched exactly against what the owner's store returns. Copied from the
   * seeder that writes it (`notes.ts`/`tasks.ts`/`study.ts`), never invented
   * here, and a title that no longer matches fails the seed rather than
   * quietly dropping a file.
   */
  readonly ownerTitle: string;
  readonly fileName: string;
  /** The mime the row will claim. Asserted against `sniffMime(bytes)` before the row is written — never a claim taken on faith. */
  readonly mime: string;
  readonly bytes: Uint8Array;
  /** Days before the profile's "today" the file was attached, at `attachedHour` — the row's `createdAt`, which the list's date column and the card's meta line both draw. */
  readonly attachedDaysAgo: number;
  readonly attachedHour: number;
}

type Rgb = readonly [number, number, number];

// --- The PDF fixtures --------------------------------------------------------

/**
 * A PDF literal string. Parentheses and the backslash are the format's own
 * delimiters and are escaped; anything outside printable ASCII is REFUSED,
 * loudly.
 *
 * That refusal is the point rather than a limitation of the builder. The two
 * fixtures below reference a standard-14 font (`/Helvetica`), whose only
 * encodings are the built-in ones — no Latin-2 — so a Serbian diacritic written
 * through this function would not fail, it would render as some other glyph.
 * The words in `DEFENCE_SHEET` and `CV_SHEET` are therefore chosen to be
 * diacritic-free Serbian, and an editor who adds „č" tomorrow gets a named
 * error at seed time instead of a silent mojibake page in the demo.
 */
function pdfString(text: string): string {
  let out = "";
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code > 0x7e || code < 0x20) {
      throw new Error(
        `seedDemoAttachments: "${text}" is not ASCII, and the standard-font PDF below cannot encode it.`,
      );
    }
    const delimiter = character === "(" || character === ")" || character === "\\";
    out += delimiter ? `\\${character}` : character;
  }
  return out;
}

/**
 * A single-page, single-font PDF carrying `title` and `lines`.
 *
 * The xref offsets are computed rather than hard-coded, exactly as
 * `minimalPdfBytes` computes them and for its reason: PDFium forgives a broken
 * table by reconstructing it, so a fixture that leaned on that forgiveness
 * would prove less than it looks like it proves. Every byte is ASCII (enforced
 * above), which is what lets string offsets stand in for byte offsets.
 */
function textPdfBytes(title: string, lines: readonly string[]): Uint8Array {
  const content = [
    "BT",
    "/F1 20 Tf",
    "72 780 Td",
    `(${pdfString(title)}) Tj`,
    "/F1 12 Tf",
    ...lines.map((line) => `0 -26 Td (${pdfString(line)}) Tj`),
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >>" +
      " /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = body.length;
  const entries = offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  const document =
    `${body}xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}` +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(document);
}

// --- The PNG fixture ---------------------------------------------------------

/** One PNG chunk: length, type, body, and the CRC over type+body (never over the length — the format's own rule). */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) {
    chunk[4 + index] = type.charCodeAt(index);
  }
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)) >>> 0);
  return chunk;
}

function joinBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

/**
 * A truecolour PNG — signature, one `IHDR`, one deflated `IDAT`, one `IEND` —
 * over `pixels`, which is `width * height` RGB triples in row order with NO
 * filter byte: a filter is a property of the file rather than of the picture,
 * so the (zero, "none") filter byte is added here, one per row.
 */
function pngBytes(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2: truecolour RGB. Bytes 10..12 stay 0 — deflate, filter 0, no interlace.

  const stride = 1 + width * 3;
  const raw = new Uint8Array(height * stride);
  for (let row = 0; row < height; row += 1) {
    raw.set(pixels.subarray(row * width * 3, (row + 1) * width * 3), row * stride + 1);
  }

  return joinBytes([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

/** A flat rectangle of one colour — the only drawing primitive the mock below needs. */
function fillRect(
  pixels: Uint8Array,
  width: number,
  [x, y, boxWidth, boxHeight]: readonly [number, number, number, number],
  rgb: Rgb,
): void {
  for (let row = y; row < y + boxHeight; row += 1) {
    for (let column = x; column < x + boxWidth; column += 1) {
      const at = (row * width + column) * 3;
      pixels[at] = rgb[0];
      pixels[at + 1] = rgb[1];
      pixels[at + 2] = rgb[2];
    }
  }
}

/**
 * A 480x300 mock of a personal site's landing page: a dark header with a mark
 * and three nav items, a title, two lines of prose and a button, over three
 * cards. It is what the task it hangs off is about — „Postaviti ličnu veb
 * stranicu" — and it is a SKETCH, which is what its file name says: flat blocks
 * at layout scale, no words drawn, because a fixture that pretended to be a
 * screenshot of a site nobody has would be pretending in the one place this
 * product refuses to (no fabricated data). What it does carry is what the
 * surfaces reading it need: real pixels, in three channels, at a size a card
 * can crop, so the grid's `<img>`, the „Slika" bar and the inline lightbox are
 * all exercised by something the app can really decode.
 */
function portfolioSketchPngBytes(): Uint8Array {
  const width = 480;
  const height = 300;
  const paper: Rgb = [244, 241, 236];
  const ink: Rgb = [32, 34, 38];
  const muted: Rgb = [150, 148, 144];
  const bronze: Rgb = [166, 124, 82];
  const card: Rgb = [228, 224, 218];

  const pixels = new Uint8Array(width * height * 3);
  fillRect(pixels, width, [0, 0, width, height], paper);
  fillRect(pixels, width, [0, 0, width, 44], ink);
  fillRect(pixels, width, [24, 14, 32, 16], bronze);
  fillRect(pixels, width, [300, 18, 34, 8], muted);
  fillRect(pixels, width, [346, 18, 34, 8], muted);
  fillRect(pixels, width, [392, 18, 34, 8], muted);
  fillRect(pixels, width, [40, 84, 260, 22], ink);
  fillRect(pixels, width, [40, 124, 400, 10], muted);
  fillRect(pixels, width, [40, 144, 320, 10], muted);
  fillRect(pixels, width, [40, 186, 128, 34], bronze);
  fillRect(pixels, width, [40, 240, 136, 44], card);
  fillRect(pixels, width, [188, 240, 136, 44], card);
  fillRect(pixels, width, [336, 240, 136, 44], card);
  return pngBytes(width, height, pixels);
}

// --- The text fixtures -------------------------------------------------------

/**
 * Two scripts, in the demo's own voice and on the subjects the notes and
 * subjects they hang off are about — the real content of a real file, not a
 * placeholder. UTF-8 throughout (which is what `sniffMime` reads them as:
 * `text/plain`), so the diacritics are spelled properly here, where nothing has
 * to encode them into a font.
 */
const GRAPH_SEARCH_SCRIPT = `# Pretraga grafova — skripta za vežbu

Skraćena verzija beleške, za ponavljanje pred ispit.

## Reprezentacije grafa

- Lista susedstva: prostor O(V + E), provera jedne grane O(deg(v)).
- Matrica susedstva: prostor O(V na kvadrat), provera grane O(1) — isplati se
  samo za guste grafove.

## DFS — pretraga u dubinu

Rekurzivno ili preko eksplicitnog steka. Složenost O(V + E).

- boje: bela (neposećen), siva (na steku), crna (završen)
- grane: tree, back, forward, cross
- back grana znači ciklus u usmerenom grafu

Primene: topološko sortiranje, komponente povezanosti, detekcija ciklusa.

## BFS — pretraga u širinu

Red (FIFO). Složenost O(V + E). U neusmerenom grafu bez težina daje najkraći
put do svakog čvora.

## Dijkstra

Prioritetni red (min-heap), složenost O((V + E) log V). Ne radi sa negativnim
težinama na granama.

## Bellman-Ford

Složenost O(V * E). Radi i sa negativnim težinama, a negativan ciklus
dostizan iz izvora prijavljuje kao rezultat.

## Šta se traži na ispitu

1. Nacrtati trag algoritma na datom grafu, korak po korak.
2. Popuniti tabelu rastojanja i roditelja.
3. Obrazložiti izbor algoritma za konkretan oblik problema.
`;

/**
 * The subject material beside it, on the subject's own topic — and the reason
 * the „Tekst" family is on screen at all: `text/plain` is one of the four
 * buckets „Datoteke" filters by, and the ONE file type this product can show
 * inside its own window without leaving the sandboxed renderer.
 */
const INDEX_SCRIPT = `# B-stabla i indeksi — skripta sa vežbi

Predmet: Napredne baze podataka. Materijal pokriva indeksiranje i planiranje
upita, ono što se pita i na kolokvijumu i na usmenom.

## Zašto indeks

Bez indeksa svaki upit sa uslovom radi pun sken tabele. Indeks je dodatna
struktura koja čuva ključeve u sortiranom obliku i time menja cenu pretrage iz
O(n) u O(log n), ali se plaća pri svakom upisu — svaki INSERT, UPDATE i DELETE
mora da održi i indeks.

## B-stablo

- svaki čvor drži više ključeva, pa je visina mala čak i za milione redova
- svi listovi su na istoj dubini (stablo je uravnoteženo po konstrukciji)
- pretraga, umetanje i brisanje su O(log n)

## B+ stablo

- podaci su SAMO u listovima; unutrašnji čvorovi drže kopije ključeva za
  navigaciju
- listovi su povezani u ulančanu listu, pa je opseg (range scan) jeftin
- zato relacione baze po pravilu koriste B+ stablo za primarni ključ

## Kada indeks ne pomaže

- kada je selektivnost niska (npr. kolona sa dve vrednosti)
- kada upit vraća većinu tabele — tada je pun sken jeftiniji od skoka po
  indeksu i vraćanja u tabelu
- kada funkcija obavija kolonu u uslovu (indeks nad kolonom se ne koristi)

## Plan izvršavanja

EXPLAIN pokazuje da li je indeks uopšte iskorišćen i koliko je redova
procenjeno. Procena je kod skupih upita često i glavni problem — statistika se
osvežava ručno, pa planer ume da pogreši red veličine.
`;

// --- The catalogue -----------------------------------------------------------

/**
 * Five files over the three owner kinds, in three mime families — and no
 * coincidence in any of the five: each file is the thing its owner is about.
 * Dates (days before "today") are spread so the newest-first list is not one
 * repeated date, and every one is older than nothing it hangs off.
 *
 * The two PDFs and the PNG are the fixtures whose bytes were built above; the
 * two scripts are the ones written above them.
 */
const DEMO_ATTACHMENTS: readonly DemoAttachmentSpec[] = [
  {
    // The note's own checklist sends the final work to the mentor; this is the
    // sheet that walks the defence through it.
    ownerKind: "note",
    ownerTitle: "Priprema za odbranu diplomskog rada",
    fileName: "Odbrana diplomskog rada.pdf",
    mime: "application/pdf",
    bytes: textPdfBytes("Odbrana diplomskog rada", [
      "Predmet: agent za organizaciju studiranja",
      "Tok odbrane: uvod, metod, rezultati, diskusija",
      "Pitanja komisije i pripremljeni odgovori",
      "Demonstracija rada na laptopu",
    ]),
    attachedDaysAgo: 2,
    attachedHour: 11,
  },
  {
    ownerKind: "task",
    ownerTitle: "Postaviti ličnu veb stranicu",
    fileName: "skica-portfolija.png",
    mime: "image/png",
    bytes: portfolioSketchPngBytes(),
    attachedDaysAgo: 5,
    attachedHour: 20,
  },
  {
    // The current CV, attached to the task that says to update it — which is
    // also the row the „Datoteke" list opens on.
    ownerKind: "task",
    ownerTitle: "Ažurirati CV i portfolio",
    fileName: "CV.pdf",
    mime: "application/pdf",
    bytes: textPdfBytes("CV", [
      "Obrazovanje: fakultet, smer informatika",
      "Tehnologije: Java, Kotlin, TypeScript, Python, C++",
      "Projekti: Nexus, web aplikacija, prevodilac",
      "Jezici: srpski, engleski",
      "Kontakt: GitHub i portfolio",
    ]),
    attachedDaysAgo: 12,
    attachedHour: 9,
  },
  {
    ownerKind: "subject",
    ownerTitle: "Napredne baze podataka",
    fileName: "B-stabla i indeksi - skripta.md",
    mime: "text/plain",
    bytes: new TextEncoder().encode(INDEX_SCRIPT),
    attachedDaysAgo: 95,
    attachedHour: 18,
  },
  {
    // A few days after the note it belongs to was written.
    ownerKind: "note",
    ownerTitle: "Algoritmi pretrage grafova",
    fileName: "Pretraga grafova - skripta.md",
    mime: "text/plain",
    bytes: new TextEncoder().encode(GRAPH_SEARCH_SCRIPT),
    attachedDaysAgo: 186,
    attachedHour: 22,
  },
];

// --- The seeder --------------------------------------------------------------

/** One owner as the three stores agree on it: an id, and the title an attachment row will quote. */
interface OwnableRow {
  readonly id: string;
  readonly title: string;
}

/**
 * The id of the owner row whose title matches, or a named error.
 *
 * A named error rather than a skip, which is the ONE place this file departs
 * from `canvas.ts`'s `refFor`. A canvas card pointing at a row that is gone is
 * a broken card, so it is omitted; an attachment that is omitted is a FILE that
 * does not exist, on the surface whose whole purpose is to hold every one — and
 * the demo already has the failure mode this file exists to close. A fixture
 * title is a claim about what another seeder writes, so a claim that stopped
 * being true belongs in the seed's own failure, next to `requireFolderId`'s.
 */
function requireOwnerId(
  owners: Readonly<Record<OwnerKind, readonly OwnableRow[]>>,
  kind: OwnerKind,
  title: string,
): string {
  const owner = owners[kind].find((row) => row.title === title);
  if (owner === undefined) {
    throw new Error(`seedDemoAttachments: no ${kind} titled "${title}" in this profile.`);
  }
  return owner.id;
}

/**
 * Attaches every file in the catalogue above, through the three public stores
 * the IPC handlers use — never a raw INSERT, so every row here is a row the app
 * could have made.
 *
 * Order inside the loop is the load-bearing part: the sniff is checked and the
 * bytes are stored BEFORE the index row that names them. A row whose blob is
 * missing is a broken surface; a blob nothing references is only garbage, and
 * garbage that a re-run of this seed finds already present and reuses.
 *
 * Must run after `seedDemoNotes`, `seedDemoTasks` and `seedDemoStudy`: every
 * spec names an owner one of those three wrote, and the id is read back through
 * the owner's own store rather than invented.
 */
export async function seedDemoAttachments(
  db: DatabaseHandle,
  ctx: DemoContext,
  io: DemoAttachmentIo,
): Promise<void> {
  const noteFiles = new NoteAttachmentStore(db, ctx.profileId);
  const taskFiles = new TaskAttachmentStore(db, ctx.profileId);
  const subjectFiles = new SubjectAttachmentStore(db, ctx.profileId);

  // The three stores each name their owner column differently — a note's
  // `title`, a task's `title`, a subject's `name` — and the attachment index
  // calls all three `owner_title`. Folded to that one shape here, which is also
  // what lets the catalogue above name an owner without knowing which store it
  // lives in.
  const owners: Readonly<Record<OwnerKind, readonly OwnableRow[]>> = {
    note: new NoteStore(db, ctx.profileId)
      .list()
      .map((note) => ({ id: note.id, title: note.title })),
    task: new TaskStore(db, ctx.profileId)
      .listActive()
      .map((task) => ({ id: task.id, title: task.title })),
    subject: new SubjectStore(db, ctx.profileId)
      .listActive()
      .map((subject) => ({ id: subject.id, title: subject.name })),
  };

  for (const spec of DEMO_ATTACHMENTS) {
    const ownerId = requireOwnerId(owners, spec.ownerKind, spec.ownerTitle);

    const sniffed = sniffMime(spec.bytes);
    if (sniffed !== spec.mime) {
      throw new Error(
        `seedDemoAttachments: "${spec.fileName}" sniffs as ${sniffed}, not the ` +
          `${spec.mime} its row would claim.`,
      );
    }

    const sha256 = await io.saveBlob(spec.bytes);
    const row = {
      fileName: spec.fileName,
      mime: spec.mime,
      sizeBytes: spec.bytes.byteLength,
      sha256,
    };
    const at = new Date(demoAt(ctx, -spec.attachedDaysAgo, spec.attachedHour, 20)).toISOString();

    switch (spec.ownerKind) {
      case "note":
        noteFiles.add(ownerId, row, at);
        break;
      case "task":
        taskFiles.add(ownerId, row, at);
        break;
      case "subject":
        subjectFiles.add(ownerId, row, at);
        break;
    }
  }
}
