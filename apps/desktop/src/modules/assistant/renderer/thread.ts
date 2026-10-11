import type { AppLocation, Citation } from "@nexus/core";
import type { AssistantMessageView } from "../shared/ipc.js";

/**
 * THE THREAD'S PURE LOGIC: how a list of stored messages becomes what the page
 * draws, and where a citation takes the user.
 *
 * **Why this is a file of its own.** Both halves are rules rather than layout,
 * and both are the kind of rule that is easy to get subtly wrong: which
 * messages fold into one quiet block of tool activity, and whether a citation is
 * a place in the app, an address on the web, or neither. Neither needs React to
 * be stated, so both are stated here and tested without rendering anything.
 *
 * **Tool activity is grouped, and a message is a boundary.** A turn's tool calls
 * and their results are a run of rows a person reads as one aside - "it looked
 * something up" - so consecutive assistant-with-calls and tool messages become
 * ONE `tools` item holding one line per call. An assistant message with visible
 * text ends the run: the answer is what the person came for, and the tool rows
 * above it belong to the step that produced it.
 */

/** One line of tool activity: what was asked, and what came back. */
export interface ThreadToolLine {
  readonly id: string;
  /** The tool's own name, or `null` for a result whose call this thread no longer holds. */
  readonly name: string | null;
  /** `null` while the call has no result yet, else whether it succeeded. */
  readonly ok: boolean | null;
  /** The result's text, trimmed to `TOOL_LINE_CHARS` for the one-line row. */
  readonly text: string;
}

/** An answer or a question, as the thread draws it. */
export interface ThreadMessageItem {
  readonly kind: "message";
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly citations: readonly Citation[];
  /** True when a citation of this message came from a `notice: "safety"` pack. */
  readonly safety: boolean;
}

/** One run of tool activity, as one quiet block. */
export interface ThreadToolItem {
  readonly kind: "tools";
  /** The id of the first message of the run, so React keys are stable. */
  readonly id: string;
  readonly lines: readonly ThreadToolLine[];
}

export type ThreadItem = ThreadMessageItem | ThreadToolItem;

/** How much of a tool result the one-line row shows. Enough to see what it found, short enough to stay one line. */
export const TOOL_LINE_CHARS = 160;

/**
 * The thread's items: messages in order, with each run of tool activity folded
 * into one item.
 *
 * A tool message is drawn as a line whether or not its call is still in the
 * list: an archived thread whose assistant message was trimmed still has to show
 * that something ran, and dropping the row would make the answer look
 * unassisted.
 */
export function groupThread(messages: readonly AssistantMessageView[]): ThreadItem[] {
  const items: ThreadItem[] = [];
  /** name by call id, so a result's line can say which tool produced it. */
  const names = new Map<string, string>();
  let run: ThreadToolLine[] | null = null;
  let runId = "";

  const flush = (): void => {
    if (run !== null && run.length > 0) items.push({ kind: "tools", id: runId, lines: run });
    run = null;
  };
  const line = (entry: ThreadToolLine): void => {
    if (run === null) {
      run = [];
      runId = entry.id;
    }
    run.push(entry);
  };

  for (const message of messages) {
    if (message.role === "user") {
      flush();
      items.push({
        kind: "message",
        id: message.id,
        role: "user",
        text: message.text,
        citations: [],
        safety: false,
      });
      continue;
    }
    if (message.role === "assistant") {
      const text = message.text.trim();
      if (text.length > 0) {
        flush();
        items.push({
          kind: "message",
          id: message.id,
          role: "assistant",
          text: message.text,
          citations: message.citations,
          safety: message.safety,
        });
      }
      for (const call of message.toolCalls ?? []) {
        names.set(call.id, call.name);
        line({ id: call.id, name: call.name, ok: null, text: "" });
      }
      continue;
    }
    line({
      id: message.id,
      name: message.toolCallId === null ? null : (names.get(message.toolCallId) ?? null),
      ok: true,
      text: firstLine(message.text),
    });
  }
  flush();
  return items;
}

/** Where clicking a citation takes the user. */
export type CitationTarget =
  /** A place in this app: a module page, an item, a Settings card. */
  | { readonly kind: "app"; readonly location: AppLocation }
  /** An https address, opened in the user's own browser (`window.nexus.openExternal`). */
  | { readonly kind: "web"; readonly url: string }
  /** Nothing to open: the citation is drawn as text. */
  | { readonly kind: "none" };

/**
 * The target of one citation.
 *
 * The order is deliberate. A citation that names a PLACE in the app is an
 * in-app link even when it also carries an address - the assistant's whole point
 * is answering "where do I do this" by opening the page. A citation with no
 * place but with an https address is the open web (`"web"`, and Wikipedia, whose
 * address the web service stores in `id` and `locator`). Everything else is
 * text: a note, a task or a pack article that the knowledge base did not give a
 * location for has no surface to open, and a link that goes nowhere is worse
 * than none.
 */
export function citationTarget(citation: Citation): CitationTarget {
  if (citation.location !== undefined) return { kind: "app", location: citation.location };
  const url = asHttpsUrl(citation.id) ?? asHttpsUrl(citation.locator ?? "");
  return url === null ? { kind: "none" } : { kind: "web", url };
}

/** The first line of a tool result, trimmed - what the quiet row shows. */
export function firstLine(text: string): string {
  const line = (text.split("\n", 1)[0] ?? "").trim();
  return line.length > TOOL_LINE_CHARS ? `${line.slice(0, TOOL_LINE_CHARS)}…` : line;
}

/** An https address, or `null`. Anything else is not a page this app may open. */
function asHttpsUrl(value: string): string | null {
  if (value === "") return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}
