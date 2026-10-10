import { BrowserWindow, dialog } from "electron";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ReaderPrintResult } from "../shared/ipc.js";
import type { ReaderPrintRequest } from "./env.js";
import { readerPrintFooter, readerPrintHeader, readerPrintHtml } from "./printHtml.js";

/**
 * Printing: the one place the Reader leaves the screen for paper (ADR-100).
 *
 * **Why a hidden window rather than a library.** `webContents.printToPDF` is
 * Chromium's own paginator, and it is the only way this app can produce a file
 * that looks like the page: the same fonts, the same line breaking, tables that
 * stay tables, and images that come through the `nx-pack:` scheme like every other
 * picture in the app. A PDF library would be a second renderer with its own
 * opinion about Serbian line breaking.
 *
 * **Why the window has JavaScript off.** The document is static HTML built by
 * `printHtml.ts` out of text this app already refused to treat as markup. Nothing
 * in it needs a script, so the print view cannot run one - which means a pack's
 * text has no path to code even here.
 *
 * **Why the file is written to a temporary directory first.** `loadFile` needs a
 * path on disk, and the document is built in memory; the directory is created per
 * job under the OS's temp root and removed in a `finally`, so a failed print
 * leaves nothing behind either.
 *
 * The save dialog is main's own, parentless on purpose: a print job belongs to the
 * process, not to whichever window happens to be in front (the shell's own
 * dialogs do the same when no window is available).
 */

export async function printReaderPdf(request: ReaderPrintRequest): Promise<ReaderPrintResult> {
  const directory = mkdtempSync(join(tmpdir(), "nexus-reader-print-"));
  const page = join(directory, "document.html");
  let view: BrowserWindow | null = null;
  try {
    writeFileSync(page, readerPrintHtml(request.document, request.language), "utf8");
    view = new BrowserWindow({
      show: false,
      webPreferences: {
        // Static HTML, rendered by this process and no other: no script, no
        // node, no preload.
        javascript: false,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    await view.loadFile(page);
    const pdf = await view.webContents.printToPDF({
      pageSize: request.paper,
      printBackground: false,
      displayHeaderFooter: true,
      headerTemplate: readerPrintHeader(request.document),
      footerTemplate: readerPrintFooter(request.document),
      margins: { top: 0.7, bottom: 0.8, left: 0.63, right: 0.63 },
    });
    const choice = await dialog.showSaveDialog({
      title: request.suggestedName,
      defaultPath: `${request.suggestedName}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (choice.canceled || choice.filePath === undefined) return { outcome: "cancelled" };
    writeFileSync(choice.filePath, pdf);
    return {
      outcome: "saved",
      filePath: choice.filePath,
      articles: request.document.articles.length,
    };
  } catch (error) {
    console.error(
      `Nexus: the Reader could not print "${request.document.packTitle}" - ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { outcome: "refused", reason: "failed" };
  } finally {
    if (view !== null && !view.isDestroyed()) view.destroy();
    rmSync(directory, { recursive: true, force: true });
  }
}
