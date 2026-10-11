import { useMemo, useState } from "react";
import { Button, Card, Select, TextArea, TextField } from "@nexus/ui";
import {
  ASCII_RADICES,
  formatAsciiCode,
  formatCodePoint,
  type AsciiChar,
  type AsciiRadix,
} from "@nexus/core";
import { collator, numberFormat } from "../../../renderer/src/moduleKit/moduleSurface.js";
import {
  asciiTextFromCodes,
  formattedAsciiCodes,
  searchAsciiRows,
  sortAsciiRows,
  type AsciiOrder,
} from "./asciiTable.js";
import { copy } from "./copy.js";

/** The name of one base, out of the four the copy declares — read at CALL time, like every leaf of a module's table. */
function radixName(radix: number): string {
  const names: Readonly<Record<string, string>> = copy.ascii.radixNames;
  return names[String(radix)] ?? String(radix);
}

/**
 * ASCII: the standard's table, the two conversions, and one search that drives
 * both directions.
 *
 * **The table is the standard's table, in its own order.** One row per code,
 * 0–127, with the four numbers a developer reaches for — decimal, hex, binary,
 * and the character — and the name the standard gives it. The default order is
 * the code's, which is what makes the table a table rather than a list; „po
 * imenu" is the alphabetical view, and it is sorted with the ACTIVE locale's
 * collator (`collator()` is the shell's `Intl.Collator(["sr-Latn", "sr"])` for a
 * Serbian reader) so the one place this tab orders words by name follows the
 * interface's language rather than the browser's default.
 *
 * **Control codes are shown by their name and never as a character.** The
 * character for code 9 IS a tab, and drawing one in a table would move the
 * column it was in and nothing else — the whole reason the engine carries the
 * standard's own names.
 *
 * **A refusal is a sentence with the code point in it, never a question mark.**
 * `č` has no ASCII code, and the honest answer is U+010D, which is what the
 * engine hands back so this page can say it.
 */

export function AsciiTab() {
  const [query, setQuery] = useState("");
  const [radix, setRadix] = useState<AsciiRadix>(10);
  const [order, setOrder] = useState<AsciiOrder>("code");

  const rows = useMemo(
    () => sortAsciiRows(searchAsciiRows(query), order, (a, b) => collator().compare(a, b)),
    [query, order],
  );

  return (
    <>
      <Card className="signals__card" title={copy.ascii.tableTitle}>
        <div className="signals__fields">
          <TextField
            label={copy.ascii.searchLabel}
            className="signals__search"
            placeholder={copy.ascii.searchPlaceholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          <Select
            label={copy.ascii.radixLabel}
            className="signals__number"
            value={String(radix)}
            onChange={(event) => {
              setRadix(Number(event.target.value) as AsciiRadix);
            }}
          >
            {ASCII_RADICES.map((option) => (
              <option key={option} value={String(option)}>
                {radixName(option)}
              </option>
            ))}
          </Select>
          <Select
            label={copy.ascii.sortLabel}
            className="signals__number"
            value={order}
            onChange={(event) => {
              setOrder(event.target.value === "name" ? "name" : "code");
            }}
          >
            <option value="code">{copy.ascii.sortByCode}</option>
            <option value="name">{copy.ascii.sortByName}</option>
          </Select>
        </div>
        <p className="nx-hint">
          {copy.ascii.tableHint.replace(
            "{shown}",
            numberFormat({ maximumFractionDigits: 0 }).format(rows.length),
          )}
        </p>
        <p className="nx-hint">{copy.ascii.controlHint}</p>
        <div className="signals__table-wrap">
          <table className="signals__ascii">
            <thead>
              <tr>
                <th scope="col">{copy.ascii.columns.decimal}</th>
                <th scope="col">{copy.ascii.columns.hex}</th>
                <th scope="col">{copy.ascii.columns.binary}</th>
                <th scope="col">{copy.ascii.columns.char}</th>
                <th scope="col">{copy.ascii.columns.name}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.code}>
                  <td className="signals__num">{entry.code}</td>
                  <td className="signals__code">{formatAsciiCode(entry.code, 16, true)}</td>
                  <td className="signals__code">{formatAsciiCode(entry.code, 2, true)}</td>
                  <td className="signals__char">{printableChar(entry)}</td>
                  <td>{entry.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <p className="nx-hint">{copy.ascii.emptyRow}</p>}
      </Card>

      <ConverterCard radix={radix} />
    </>
  );
}

/**
 * The character a row draws, or an empty cell.
 *
 * Only the printable range 33–126: below it every code is a control character
 * (invisible, or — the tab and the line feed — a character that would rearrange
 * the table it is drawn in), and 127 is DELETE. Space is 32 and is a space,
 * which is why it is out too. The name column is what names all of them.
 */
function printableChar(entry: AsciiChar): string {
  return entry.code >= 33 && entry.code <= 126 ? entry.char : "";
}

/** The two conversions, over the same base the table is showing codes in. */
function ConverterCard({ radix }: { readonly radix: AsciiRadix }) {
  const [text, setText] = useState("");
  const [codes, setCodes] = useState("");
  const [refusedText, setRefusedText] = useState<readonly number[]>([]);
  const [refusedToken, setRefusedToken] = useState<string | null>(null);

  return (
    <Card className="signals__card" title={copy.ascii.codesLabel}>
      <div className="signals__pair">
        <TextArea
          label={copy.ascii.textLabel}
          className="signals__message"
          rows={3}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <TextArea
          label={copy.ascii.codesLabel}
          className="signals__message signals__message--code"
          rows={3}
          value={codes}
          onChange={(event) => {
            setCodes(event.target.value);
          }}
        />
      </div>
      <div className="signals__actions">
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            const result = formattedAsciiCodes(text, radix);
            setRefusedToken(null);
            if (!result.ok) {
              setRefusedText(result.codePoints);
              return;
            }
            setRefusedText([]);
            setCodes(result.written);
          }}
        >
          {copy.ascii.toCodes}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            const result = asciiTextFromCodes(codes, radix);
            setRefusedText([]);
            if (!result.ok) {
              setRefusedToken(result.token);
              return;
            }
            setRefusedToken(null);
            setText(result.text);
          }}
        >
          {copy.ascii.toText}
        </Button>
      </div>
      {refusedText.length > 0 && (
        <p className="signals__error">
          {copy.ascii.refused}{" "}
          <span className="signals__code">
            {refusedText.map((point) => formatCodePoint(point)).join(" ")}
          </span>
        </p>
      )}
      {refusedToken !== null && (
        <p className="signals__error">
          {copy.ascii.codesRefused} <span className="signals__code">{refusedToken}</span>
        </p>
      )}
    </Card>
  );
}
