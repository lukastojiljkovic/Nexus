/**
 * The serial terminal's two pieces of arithmetic: assembling a chunked stream
 * into lines, and drawing bytes a person cannot read.
 *
 * **Why a line assembler is a module and not a `split`.** `navigator.serial`
 * hands the page whatever the driver had ready: a read is not a line, and a
 * `\r\n` split across two reads is the normal case rather than the corner one.
 * A `String.split("\n")` at the call site loses the last partial line and then
 * reports a mangled first line on the next read, which is exactly the bug that
 * makes a terminal useless for the thing it is for. So the carry is explicit:
 * the caller holds whatever did not end in a line ending yet, and this file
 * decides nothing about it that the ending the user chose does not say.
 *
 * **Three endings, because three are what a device can send.** `crlf` is what an
 * Arduino's `println` produces, `lf` is what a Linux board produces, and `none`
 * is a device that streamed everything without one — in that case the carry IS
 * the line, and the page shows it growing rather than pretending it has not
 * arrived.
 */

/** The line ending the user has chosen for the terminal. */
export const LINE_ENDINGS = ["crlf", "lf", "none"] as const;
export type LineEnding = (typeof LINE_ENDINGS)[number];

/**
 * The baud rates a serial tool offers.
 *
 * Themselves are a published, standard series rather than a list this file
 * invented: they are the rates every UART prescaler can divide down to, and a
 * port set to one of them is a port two devices can agree on. The page offers
 * these plus the field's own value for a device that uses something else.
 */
export const BAUD_RATES = [
  300, 1_200, 2_400, 4_800, 9_600, 19_200, 38_400, 57_600, 115_200,
] as const;

/** What one read of the port produced: the lines that ended, and the text that has not ended yet. */
export interface SplitChunk {
  readonly lines: readonly string[];
  readonly carry: string;
}

/**
 * One chunk of a serial stream folded into complete lines.
 *
 * The carry is returned rather than held, because the page's read loop is what
 * owns the state and a module-level buffer would be a second copy of it. A
 * trailing `\r` with nothing after it is kept in the carry: the next read very
 * probably begins with the `\n` of the same ending, and splitting there would
 * produce two empty lines instead of one.
 */
export function splitSerialChunk(
  carry: string,
  chunk: string,
  ending: LineEnding,
): SplitChunk {
  const text = carry + chunk;
  if (ending === "none") return { lines: [], carry: text };
  // Both endings are read whatever the user chose: a device's own ending is a
  // property of the device, and refusing to split on the other one would leave a
  // terminal showing one very long line to somebody who guessed wrong.
  const lines: string[] = [];
  let rest = text;
  for (;;) {
    const match = /\r\n|\n|\r/.exec(rest);
    if (match === null) break;
    // A `\r` as the last character may be the first half of a `\r\n` that has
    // not arrived yet: holding it costs one more read and saves a line pair. The
    // hold is only for the `crlf` ending, which is the one a reader chose
    // because that is what their device prints — with `lf` a trailing `\r` is
    // just another ending, and holding it would delay the last line of every
    // chunk for no reason.
    if (ending === "crlf" && match[0] === "\r" && match.index === rest.length - 1) break;
    lines.push(rest.slice(0, match.index));
    rest = rest.slice(match.index + match[0].length);
  }
  return { lines, carry: rest };
}

/**
 * Text as a hexadecimal dump: sixteen bytes a row, an offset, and the printable
 * column — the shape a terminal's hex view has had since hex views existed,
 * because a person reading one is looking for a byte's value AND its character
 * at the same time.
 *
 * Bytes come from UTF-8 for a string, which is what a serial device's text is;
 * a value the viewer cannot decode shows as `·` in the printable column and its
 * real value in the hex column, so nothing is hidden. `limit` bounds the work: a
 * terminal's log can be long, and the view is of its tail — the offsets are
 * therefore offsets within the dumped text, which is stated here so nobody reads
 * them as positions in a stream this module cannot see.
 */
export function toHexView(text: string, limit = 4096): readonly string[] {
  const bytes = [...new TextEncoder().encode(text)];
  const from = Math.max(0, bytes.length - limit);
  const rows: string[] = [];
  for (let offset = from; offset < bytes.length; offset += 16) {
    const row = bytes.slice(offset, offset + 16);
    const hex = row.map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
    const printable = row
      .map((byte) => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : "·"))
      .join("");
    rows.push(`${offset.toString(16).padStart(6, "0")}  ${hex.padEnd(47)}  ${printable}`);
  }
  return rows;
}
