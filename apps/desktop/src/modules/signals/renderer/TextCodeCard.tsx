import { useState } from "react";
import { Button, Card, TextArea } from "@nexus/ui";
import { copy } from "./copy.js";

/** What an encoder answers: the code, and the characters it sent differently or could not send. */
export interface TextEncoded {
  readonly code: string;
  readonly transliterated: readonly string[];
  readonly unsupported: readonly string[];
}

/** What a decoder answers: the text, and the words or cells it could not read. */
export interface TextDecoded {
  readonly text: string;
  readonly unknown: readonly string[];
}

/** One line under the buttons: what was said, and the items it is about. */
interface Note {
  readonly label: string;
  readonly items: readonly string[];
}

/**
 * One text field and one code field, and the two conversions between them: the
 * shape the NATO and Braille tabs share.
 *
 * **What was not sent is printed, never silently dropped.** An encoder that
 * transliterated č or refused € answers those characters, and the card names them
 * beside the result. A decoder's unknown words or cells are shown as what they
 * are, not as a blank.
 *
 * The code field is a view of the text in the same way the Morse tab's is: the
 * conversion writes it, and the decode reads it back into the text field.
 */
export function TextCodeCard({
  title,
  hint,
  encode,
  decode,
}: {
  readonly title: string;
  readonly hint: string;
  readonly encode: (text: string) => TextEncoded;
  readonly decode: (code: string) => TextDecoded;
}) {
  const [text, setText] = useState("");
  const [code, setCode] = useState("");
  const [notes, setNotes] = useState<readonly Note[]>([]);

  return (
    <Card className="signals__card" title={title}>
      <p className="nx-hint">{hint}</p>
      <div className="signals__pair">
        <TextArea
          label={copy.textCode.textLabel}
          className="signals__message"
          rows={3}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <TextArea
          label={copy.textCode.codeLabel}
          className="signals__message signals__message--code"
          rows={3}
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
          }}
        />
      </div>
      <div className="signals__actions">
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            const result = encode(text);
            setCode(result.code);
            setNotes(
              [
                { label: copy.textCode.transliterated, items: result.transliterated },
                { label: copy.textCode.unsupported, items: result.unsupported },
              ].filter((note) => note.items.length > 0),
            );
          }}
        >
          {copy.textCode.toCode}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            const result = decode(code);
            setText(result.text);
            setNotes(
              result.unknown.length > 0 ? [{ label: copy.textCode.unknown, items: result.unknown }] : [],
            );
          }}
        >
          {copy.textCode.toText}
        </Button>
      </div>
      {notes.map((note) => (
        <p key={note.label} className="signals__error">
          {note.label} <span className="signals__code">{note.items.join(" ")}</span>
        </p>
      ))}
    </Card>
  );
}
