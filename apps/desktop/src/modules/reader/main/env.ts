import type { ReaderPaperSize, ReaderPrintResult } from "../shared/ipc.js";
import type { PrintLanguage, ReaderPrintDocument } from "./printHtml.js";

/**
 * The Reader's environment: the three things this module needs that only
 * `main/index.ts` can supply, injected so that everything else about the module
 * is electron-free and testable.
 *
 * **What is injected and why each one cannot be reached from here.** `userData`
 * is where installed packs and the search cache live (ADR-091 §5, ADR-100);
 * `publicKeyPem` is the release key the installed packs' manifests are verified
 * against, and it is compiled into the binary rather than read from anywhere this
 * folder can see; and `print`/`openExternal` are the two capabilities that need a
 * window - a hidden print view for `webContents.printToPDF` and the OS's own
 * browser for a pack's source line.
 *
 * **Why a configured singleton rather than a parameter.** A module's entry point
 * is `register(host)` and nothing else (ADR-090): the kit hands a module a
 * session, not an environment, so the environment is configured once at startup
 * and read when a handler runs. `readerEnvironment()` THROWS when it has not been
 * configured, deliberately - a module whose environment was never installed must
 * fail loudly rather than serve a page with no packs and no way to print.
 */

export interface ReaderPrintRequest {
  readonly document: ReaderPrintDocument;
  /** The language the sentences inside the document are already written in. */
  readonly language: PrintLanguage;
  readonly paper: ReaderPaperSize;
  /** What the save dialog offers first: the pack's title, made file-name-safe. */
  readonly suggestedName: string;
}

export interface ReaderEnvironment {
  readonly userData: string;
  readonly publicKeyPem: string;
  /** Renders the document to a PDF and asks the user where to keep it. */
  readonly print: (request: ReaderPrintRequest) => Promise<ReaderPrintResult>;
  /** Opens one address in the user's own browser; answers false when it is not one this app opens. */
  readonly openExternal: (url: string) => Promise<boolean>;
}

let current: ReaderEnvironment | null = null;

export function configureReaderEnvironment(environment: ReaderEnvironment): void {
  current = environment;
}

export function readerEnvironment(): ReaderEnvironment {
  if (current === null) {
    throw new Error("Nexus: the Reader's environment was never installed.");
  }
  return current;
}
