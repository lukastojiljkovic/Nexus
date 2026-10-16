/**
 * The WORKSHOP module through the assistant's eyes: one tool that opens it on the
 * tool the person named.
 *
 * **Why nothing here reads a file.** Every file the Workshop shows arrives through
 * the native dialog and is parsed in a renderer worker, and main never sees its
 * bytes. So the tool names a view and the page switches to it (`navigateTo` with
 * an `action` the page applies, `renderer/views.ts`); the person picks the file
 * there. A tool that processed a model here would be a second parser over
 * untrusted bytes.
 *
 * **Why the recent-files list is not offered.** It lives in the renderer's
 * `localStorage`, which main cannot read, and `reopen` refuses any path main did
 * not hand out in this session, so the page could not reopen most of it anyway.
 */

import type { Tool } from "@nexus/core";
import { asArgs, asEnum } from "./args.js";
import { assertLive, guard, okResult, phrase, text, type AssistantPhrase } from "./support.js";

/** The page's tools, in the order the Workshop's switcher draws them (`renderer/views.ts`). */
const WORKSHOP_TOOLS = ["model", "toolpath", "board", "pdf", "images"] as const;
type WorkshopTool = (typeof WORKSHOP_TOOLS)[number];

const TOOL_NAME: Record<WorkshopTool, { sr: string; en: string }> = {
  model: { sr: "STL model", en: "STL model" },
  toolpath: { sr: "G-kod", en: "G-code" },
  board: { sr: "Gerber ploča", en: "Gerber board" },
  pdf: { sr: "PDF alati", en: "PDF tools" },
  images: { sr: "alati za slike", en: "image tools" },
};

const OPENED: AssistantPhrase<[tool: string]> = {
  sr: (tool) =>
    `Radionica je otvorena na alatu „${tool}“. Datoteku korisnik bira na stranici; asistent je ne čita.`,
  en: (tool) =>
    `The Workshop is open on “${tool}”. The user picks the file on the page; the assistant does not read it.`,
};

export function workshopTools(): readonly Tool[] {
  return [
    {
      name: "workshop.open",
      description: {
        sr: "Otvara Radionicu na jednom alatu: pregled STL modela, G-koda ili Gerber ploča, PDF alati (spajanje, deljenje, rotacija, brojevi strana) ili alati za slike (u PDF, pretvaranje, veličina). Koristi ga kad korisnik traži jedan od tih alata.",
        en: "Opens the Workshop on one tool: the STL model, G-code or Gerber board viewer, the PDF tools (merge, split, rotate, number pages) or the image tools (to PDF, convert, resize). Use it when the user asks for one of those tools.",
      },
      parameters: {
        type: "object",
        properties: {
          tool: {
            type: "string",
            enum: WORKSHOP_TOOLS,
            description: "model: STL viewer; toolpath: G-code; board: Gerber; pdf: PDF tools; images: image tools.",
          },
        },
        required: ["tool"],
        additionalProperties: false,
      },
      effect: "navigate",
      run: (rawArgs, context) =>
        guard(context, () => {
          assertLive(context);
          const tool = asEnum(asArgs(rawArgs).tool, "tool", WORKSHOP_TOOLS);
          return okResult(phrase(context.locale, OPENED, text(context.locale, TOOL_NAME[tool])), {
            navigateTo: { module: "workshop", action: { name: "open-tool", payload: { tool } } },
          });
        }),
    },
  ];
}
