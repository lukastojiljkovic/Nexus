import { createContext, useContext } from "react";
import type { ToolRiskClass } from "@nexus/core";

import { strings } from "./strings.js";

/**
 * The founder's *„da obavezno stoje vidljivi disclaimeri… da nas neko ne tuzi
 * do bankrota"*, as three mechanisms the drawer applies rather than three things
 * a tool remembers.
 *
 * **Everything here is driven by `ToolRegistration.riskClass`, and nothing by
 * the surface.** A tool declares what could go wrong with its answer; the HOST
 * draws the notice, and the shared copy button appends the travelling line. A
 * surface cannot forget its notice, cannot draw the wrong one, and cannot
 * opt out of the copied one — which is the only arrangement where „every
 * regulated tool carries a notice" is a property of the build instead of a
 * standing instruction to fifty authors.
 *
 * **Why a context and not a prop.** The notice is the host's job and is drawn by
 * the host, so it needs no context at all. The COPY line does: it is appended
 * inside `CopyButton`, which sits five components deep in whichever surface is
 * open and is written once for all of them. Threading a `riskClass` prop from
 * the drawer through every surface to every copy button is the version of this
 * that is one forgotten prop away from a silent hole, and a forgotten prop looks
 * exactly like a tool that is harmless.
 *
 * The default is `"none"`, which is safe in the only direction that matters: a
 * surface rendered outside the drawer (the gallery, a test) adds nothing to a
 * copied value rather than asserting a risk class it was not given.
 */
const ToolRiskContext = createContext<ToolRiskClass>("none");

export const ToolRiskProvider = ToolRiskContext.Provider;

/**
 * What to append to a copied result — the empty string for `none`.
 *
 * Appended rather than prefixed so the value the user actually wanted is still
 * the first thing in the paste, and separated by a blank line so it reads as a
 * footer rather than as part of the answer.
 *
 * This is the one mechanism of the three that leaves the window. The notice on
 * screen is read by the person computing; the harm happens later and elsewhere,
 * in the email, the site diary or the client memo the number was pasted into —
 * and that is also the only place a third party might ever encounter it.
 */
export function useCopySuffix(): string {
  const riskClass = useContext(ToolRiskContext);
  if (riskClass === "none") return "";
  return `\n\n${strings.pro.risk[riskClass].export}`;
}

/**
 * The line above a tool's body, and the long form folded behind it.
 *
 * Quiet, and in the same place on every affected tool. A warning box per tool
 * across nineteen toolkits is banner blindness with an amber border — the reader
 * stops seeing it by the fourth surface, which is the failure mode the notice
 * exists to avoid, and it is also precisely the look this app's design rules
 * ban. Always there and unremarkable beats loud and tuned out.
 *
 * `<details>` rather than a link to „Podešavanja": the long form belongs where
 * the short one is, and a native disclosure needs no state, keeps the keyboard
 * and the screen reader behaviour the platform already has, and cannot leave the
 * user somewhere else in the app with their inputs gone.
 *
 * Renders nothing for `none` — an explicit „this endangers nobody" is a fact the
 * registration states so that nothing is drawn, not a fact to draw.
 */
export function ToolRiskNotice({ riskClass }: { riskClass: ToolRiskClass }) {
  if (riskClass === "none") return null;
  const s = strings.pro.risk[riskClass];
  return (
    <details className="tool__risk">
      <summary className="tool__risk-line">
        <span>{s.line}</span>
        <span className="tool__risk-more">{strings.pro.risk.detail}</span>
      </summary>
      <p className="tool__risk-note">{s.note}</p>
    </details>
  );
}
