/**
 * A minimal RFC-4180 CSV writer for the IMEX human-readable table mirrors
 * (ADR-009: "usable without us"). Pure and platform-neutral — no file IO, no
 * clock reads. Every field that contains a double quote, comma, `\r` or `\n`
 * is wrapped in quotes with embedded quotes doubled; every other field is
 * written verbatim. Rows are written in the given order, one per line,
 * CRLF-terminated (including the header and the final row) — the RFC's own
 * line-ending convention, so the file opens cleanly in spreadsheet tools on
 * every platform.
 */

/** One CSV cell's value before stringification; `null`/`undefined` render as an empty field. */
export type CsvValue = string | number | boolean | null | undefined;

const NEEDS_QUOTING = /["\r\n,]/;

/** Renders one cell: `null`/`undefined` -> "", boolean -> "true"/"false", else `String(value)`, quoted per RFC-4180 when needed. */
function renderCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "boolean" ? (value ? "true" : "false") : String(value);
  return NEEDS_QUOTING.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

/**
 * Renders a full CSV document: a header row followed by one row per entry of
 * `rows`, in the given order — never re-sorted, since the caller (the export
 * builder) already orders rows to match the NDJSON. Every row is CRLF-
 * terminated, including the last.
 */
export function toCsv(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<CsvValue>>): string {
  const lines = [headers.map(renderCell).join(","), ...rows.map((row) => row.map(renderCell).join(","))];
  return lines.map((line) => `${line}\r\n`).join("");
}
