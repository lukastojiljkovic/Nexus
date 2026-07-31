/**
 * The electron-free half of the in-app file preview (DOC / ADR-064): the
 * `doc:read-text` gate and decoder, the dedicated PDF window's navigation
 * predicate, and the smoke rehearsal's fixture PDF. The window itself (a
 * `BrowserWindow` with `plugins: true` and no preload) lives in `index.ts`
 * beside `createWindow` — this module holds exactly the pieces a Vitest node
 * run can prove, mirroring how `attachments.ts` keeps IO logic testable while
 * `index.ts` owns the Electron objects.
 */

/** The display-only extension reading (ADR-064): offered for text preview by name alone, used ONLY for rows whose stored mime predates the text sniff. */
function hasTextPreviewExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".txt") || lower.endsWith(".md");
}

/**
 * Whether `doc:read-text` may serve this row (ADR-064). Two ways in, both
 * narrow: a stored `text/plain` (the sniff already read the bytes), or an
 * `application/octet-stream` row whose NAME says `.txt`/`.md` — those are the
 * text files attached before the sniff learned text, and the extension reading
 * is allowed for offering the preview only; the stored mime (and therefore
 * what `nx-blob:` serves) stays untouched. Any other mime is refused by name:
 * an extension never overrides a sniffed type, so a `.txt`-named zip stays a
 * zip with no preview.
 */
export function isTextPreviewAttachment(mime: string, fileName: string): boolean {
  if (mime === "text/plain") return true;
  if (mime !== "application/octet-stream") return false;
  return hasTextPreviewExtension(fileName);
}

/**
 * Decodes a text attachment's bytes for the preview pane: UTF-8, with a
 * leading byte-order mark stripped (`TextDecoder`'s default already consumes
 * a genuine UTF-8 BOM; the explicit strip also covers bytes that reached us
 * already decoded-and-re-encoded with a leading U+FEFF). Invalid sequences
 * decode to U+FFFD rather than throwing — a legacy octet-stream row was never
 * sniffed, and a replacement character in a read-only pane is the honest
 * rendering of a byte that is not text.
 */
export function decodePreviewText(bytes: Uint8Array): string {
  const text = new TextDecoder("utf-8").decode(bytes);
  // U+FEFF spelled as a char code rather than an escape: an invisible literal
  // in source trips the no-irregular-whitespace lint, deliberately.
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * The preview window's `will-navigate` allowlist (ADR-064, SEC-EL-03 adapted):
 * exactly the one `nx-blob:` URL the window was opened with — nothing else,
 * ever. The scheme is registered `standard`, so Chromium may report the URL
 * with a trailing slash appended; that sole normalization is allowed, anything
 * further appended is not.
 */
export function isAllowedPreviewNavigation(blobUrl: string, url: string): boolean {
  return url === blobUrl || url === `${blobUrl}/`;
}

/**
 * A minimal, structurally valid single-page PDF — the smoke rehearsal's
 * fixture (ADR-064's spike: custom-protocol PDF hosting has version-specific
 * history in Electron, so the render is proved against the real built app).
 * Built here rather than shipped as a binary asset so the smoke run cannot
 * lose the file, and so a unit test can hold the fixture to the same sniff
 * the real attachment path applies. The xref offsets are computed, not
 * hard-coded — PDFium forgives a broken table by reconstructing it, and a
 * fixture that leaned on that forgiveness would prove less than it seems to.
 * Every byte is ASCII, which is what lets string offsets stand in for byte
 * offsets.
 */
export function minimalPdfBytes(): Uint8Array {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n",
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(body.length);
    body += object;
  }

  const xrefOffset = body.length;
  const entries = offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  const document =
    `${body}xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}` +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(document);
}
