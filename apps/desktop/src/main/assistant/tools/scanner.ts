/**
 * The SCANNER module through the assistant's eyes: one tool that opens it ready to
 * read text from an image.
 *
 * **Why the assistant never reads the image.** A scan is a picked file, a paste or
 * a camera frame, recognised by a renderer worker; main has no path it may name
 * and no OCR engine of its own. So the tool opens the page and, when the person
 * said where the image is, points the page at that source. The page does not start
 * the camera: the person presses the button, as the camera permission requires.
 *
 * **Why saving is not a tool here.** The page's own "save as note" is the only
 * route for recognised text, and `notes.create` already serves a transcript the
 * person dictates.
 */

import type { AppLocation, AssistantText, Tool } from "@nexus/core";
import { asArgs, asOptionalEnum } from "./args.js";
import { assertLive, guard, okResult, text } from "./support.js";

const SOURCES = ["file", "camera"] as const;
type ScanSource = (typeof SOURCES)[number];

/** What the page is ready for, in the person's words; the page does not start a source by itself. */
const READY: Record<ScanSource | "none", AssistantText> = {
  file: {
    sr: "Skener je otvoren; korisnik bira sliku na stranici.",
    en: "The Scanner is open; the user picks the image on the page.",
  },
  camera: {
    sr: "Skener je otvoren; korisnik sam pokreće kameru na stranici.",
    en: "The Scanner is open; the user starts the camera on the page.",
  },
  none: { sr: "Skener je otvoren.", en: "The Scanner is open." },
};

export function scannerTools(): readonly Tool[] {
  return [
    {
      name: "scanner.open",
      description: {
        sr: "Otvara Skener spreman da iz slike pročita tekst: sa fajla ili sa kamere. Tekst korisnik čuva kao belešku dugmetom na stranici. Koristi ga kad korisnik hoće da pročita tekst sa fotografije ili slike.",
        en: "Opens the Scanner ready to read text from an image: from a file or the camera. The user saves the text as a note with the page's button. Use it when the user wants text read from a photo or a picture.",
      },
      parameters: {
        type: "object",
        properties: {
          source: {
            type: "string",
            enum: SOURCES,
            description: "file: an image file; camera: the device camera. Leave it out to open the page without a source.",
          },
        },
        required: [],
        additionalProperties: false,
      },
      effect: "navigate",
      run: (rawArgs, context) =>
        guard(context, () => {
          assertLive(context);
          const source = asOptionalEnum(asArgs(rawArgs).source, "source", SOURCES);
          const navigateTo: AppLocation =
            source === undefined
              ? { module: "scanner" }
              : { module: "scanner", action: { name: "source", payload: { source } } };
          return okResult(text(context.locale, READY[source ?? "none"]), { navigateTo });
        }),
    },
  ];
}
