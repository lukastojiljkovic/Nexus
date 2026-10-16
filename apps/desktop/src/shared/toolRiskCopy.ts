import type { AssistantText, ToolRiskClass } from "@nexus/core";

/**
 * The one line of each risk notice the drawer draws under a tool (`toolRisk.tsx`'s
 * `ToolRiskNotice`), in both locales. Main cannot read the renderer's `strings`,
 * so the assistant's `drawer.run` repeats the line from here; `toolRiskCopy.test.ts`
 * (in the renderer, beside `builtinModuleCopy.test.ts`) fails the moment the two
 * disagree. `none` has no notice, so it has no entry.
 */
export const TOOL_RISK_LINES: Readonly<Record<Exclude<ToolRiskClass, "none">, AssistantText>> = {
  "life-safety": {
    sr: "Račun iz vrednosti koje uneseš. Ne zamenjuje proračun, proveru ni odgovornost ovlašćenog inženjera.",
    en: "A calculation from the values you enter. It does not replace the calculation, checking or responsibility of a chartered engineer.",
  },
  wellness: {
    sr: "Informativan račun. Nije medicinski ni trenažni savet.",
    en: "An informational calculation. It is not medical or training advice.",
  },
  "legal-procedure": {
    sr: "Računa datume po pravilu koje izabereš. Izbor pravila i provera roka su pravno pitanje.",
    en: "Calculates dates by the rule you choose. Choosing the rule and checking the deadline are legal questions.",
  },
  financial: {
    sr: "Informativan račun iz stopa i iznosa koje uneseš. Nije poreski ni računovodstveni savet.",
    en: "An informational calculation from the rates and amounts you enter. It is not tax or accounting advice.",
  },
  "food-safety": {
    sr: "Račun iz vrednosti koje uneseš. Bezbednost hrane određuju tvoj HACCP plan i propisi.",
    en: "A calculation from the values you enter. Food safety is determined by your HACCP plan and by regulations.",
  },
};
