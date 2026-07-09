import { Fragment, useMemo } from "react";
import katex from "katex";

export interface MathTextProps {
  /** Raw text, possibly containing `$…$` inline or `$$…$$` display KaTeX math. */
  text: string;
  className?: string;
}

type Segment =
  | { kind: "text"; value: string }
  | { kind: "inline"; value: string }
  | { kind: "display"; value: string };

/**
 * Finds the next occurrence of `token` at or after `start`, skipping any
 * backslash-escaped character (so `\$` never counts as a delimiter). Returns
 * -1 when `token` does not occur again — the caller then treats the opening
 * delimiter as a literal character rather than swallowing the rest of the
 * string.
 */
function findUnescaped(input: string, start: number, token: string): number {
  const limit = input.length - token.length;
  let i = start;
  while (i <= limit) {
    if (input[i] === "\\") {
      i += 2;
      continue;
    }
    if (input.startsWith(token, i)) return i;
    i += 1;
  }
  return -1;
}

/**
 * Deterministically splits `input` into plain-text and math segments: `$…$`
 * is inline math, `$$…$$` is display math, and `\$` is an escaped literal
 * dollar sign (dropped from the output text). An unclosed `$` degrades to a
 * literal `$` character rather than consuming the remainder of the string —
 * math never swallows unrelated text and never throws.
 */
function parseMathSegments(input: string): Segment[] {
  const segments: Segment[] = [];
  let buffer = "";
  let i = 0;
  const n = input.length;

  const flush = () => {
    if (buffer.length > 0) {
      segments.push({ kind: "text", value: buffer });
      buffer = "";
    }
  };

  while (i < n) {
    const ch = input[i];
    if (ch === "\\" && input[i + 1] === "$") {
      buffer += "$";
      i += 2;
      continue;
    }
    if (ch === "$") {
      const isDisplay = input[i + 1] === "$";
      const delim = isDisplay ? "$$" : "$";
      const searchStart = i + delim.length;
      const closeIndex = findUnescaped(input, searchStart, delim);
      if (closeIndex === -1) {
        // No closing delimiter anywhere ahead: this `$` is literal text.
        buffer += ch;
        i += 1;
        continue;
      }
      flush();
      segments.push({
        kind: isDisplay ? "display" : "inline",
        value: input.slice(searchStart, closeIndex),
      });
      i = closeIndex + delim.length;
      continue;
    }
    buffer += ch;
    i += 1;
  }
  flush();
  return segments;
}

/** Renders one math segment to trusted KaTeX HTML; malformed TeX degrades to KaTeX's own inline error span instead of throwing. */
function renderMath(value: string, displayMode: boolean): string {
  return katex.renderToString(value, {
    throwOnError: false,
    trust: false,
    maxExpand: 1000,
    displayMode,
  });
}

/**
 * Renders Serbian card text that may contain KaTeX math among plain words
 * (STUDY flashcards). Plain segments render as ordinary React text; only
 * KaTeX's own generated markup is injected via `dangerouslySetInnerHTML`, one
 * span (inline) or div (display) per math segment. KaTeX output has no
 * explicit `color`, so it inherits `currentColor` and matches the surrounding
 * themed text in both Dan and Noć.
 */
export function MathText({ text, className }: MathTextProps) {
  const rendered = useMemo(
    () =>
      parseMathSegments(text).map((segment, index) => {
        if (segment.kind === "text") {
          return <Fragment key={index}>{segment.value}</Fragment>;
        }
        const html = renderMath(segment.value, segment.kind === "display");
        return segment.kind === "display" ? (
          // eslint-disable-next-line react/no-danger
          <div key={index} className="study__katex" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          // eslint-disable-next-line react/no-danger
          <span key={index} className="study__katex" dangerouslySetInnerHTML={{ __html: html }} />
        );
      }),
    [text],
  );

  return <span className={className ? `study__math ${className}` : "study__math"}>{rendered}</span>;
}
