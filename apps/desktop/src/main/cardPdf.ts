import { writeFile } from "node:fs/promises";
import { BrowserWindow, dialog } from "electron";
import type { PdfSaveRequest } from "./moduleIpc.js";
import { pdfWriteTarget } from "./pdfTarget.js";
import { shellStrings } from "./shellStrings.js";

/**
 * The one place the app renders a document to a PDF, and the one place a
 * filesystem path is born for it.
 *
 * **Why this is the shell's file and not the card module's.** A module's
 * main-process half is `modules/<id>/main/register.ts`, which the kit keeps
 * electron-free so it can be tested: it reaches main through the narrow platform
 * the kit hands it, and a `BrowserWindow` is not part of that (`moduleIpc.ts`
 * says so where the platform is declared). What the card needs is therefore one
 * CAPABILITY - print this document, save it where the user says - implemented
 * here, beside the window, the dialog and the print pipeline it is made of, and
 * handed to the kit as `ModulePlatform.savePdf` by `index.ts`.
 *
 * **Why the path cannot come from anywhere but the dialog.** The renderer sends
 * a profile id and a page format; the module builds the document from the
 * database; this file asks the user where to put it. `pdfWriteTarget`
 * (`./pdfTarget.js`, electron-free so it can be tested) is the whole of the
 * validation between that answer and `writeFile`, so a path the dialog could
 * never produce is refused by a function with a test rather than by the shape of
 * a call site (SEC-EL, `imex.ts`'s rule restated).
 *
 * **Why the printing window has no script and no preload.** The document is
 * markup built in main from data main read, and the escaping is `print.ts`'s
 * (`escapeHtml`). Turning JavaScript off in the window that renders it is the
 * second half of the same refusal - a document that carries no script cannot run
 * one that escaped with it - and it costs nothing, because laying out paper needs
 * none.
 */

/**
 * Renders the document to a PDF and writes it where the user chose. Answers the
 * path written, or `null` when the dialog was closed without a choice - a cancel
 * is not a failure, and the page says nothing about it.
 */
export async function saveCardPdf(request: PdfSaveRequest): Promise<string | null> {
  const options = {
    defaultPath: request.defaultPath,
    filters: [{ name: shellStrings().cardPdfFilterName, extensions: ["pdf"] }],
  };
  const owner = BrowserWindow.getFocusedWindow();
  const { canceled, filePath } = owner
    ? await dialog.showSaveDialog(owner, options)
    : await dialog.showSaveDialog(options);
  if (canceled || filePath === undefined) return null;

  // Validated BEFORE the document is rendered: a refusal costs nothing, and a
  // path this refuses is one nothing should have spent a print on.
  const target = pdfWriteTarget(filePath);
  const bytes = await printDocument(request);
  await writeFile(target, bytes);
  return target;
}

/**
 * One hidden window, one document, one PDF.
 *
 * The document arrives as a `data:` URL rather than through a temporary file:
 * the app leaves no scratch files behind (a temp file is a file somebody has to
 * clean up, and a failed print leaves one), and a card is a few kilobytes of
 * markup, well inside what a URL carries.
 */
async function printDocument(request: PdfSaveRequest): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    // A size is required of a window that is never shown, and it does not affect
    // the page: `printToPDF` lays the document out on the paper it is handed.
    width: 900,
    height: 1200,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
    },
  });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(request.html)}`);
    return await win.webContents.printToPDF({
      printBackground: true,
      pageSize: request.pageSize,
      margins: request.margins,
    });
  } finally {
    // Always, including on a refusal: a hidden window left behind is a renderer
    // process this app never gets back.
    win.destroy();
  }
}
