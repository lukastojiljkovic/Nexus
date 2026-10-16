import { describe, expect, it } from "vitest";
import { TOOL_RISK_CLASSES, type ToolRiskClass } from "@nexus/core";
import { TOOL_RISK_LINES } from "../../shared/toolRiskCopy.js";
import { en } from "./strings.en.js";
import { sr } from "./strings.sr.js";

describe("TOOL_RISK_LINES", () => {
  it("holds the drawer's own notice line for every class that has one, in both locales", () => {
    const noticed = TOOL_RISK_CLASSES.filter((riskClass): riskClass is Exclude<ToolRiskClass, "none"> => riskClass !== "none");
    expect(Object.keys(TOOL_RISK_LINES).sort()).toEqual([...noticed].sort());
    for (const [locale, table] of [
      ["sr", sr],
      ["en", en],
    ] as const) {
      for (const riskClass of noticed) {
        expect(TOOL_RISK_LINES[riskClass][locale], `${riskClass} ${locale}`).toBe(
          table.pro.risk[riskClass].line,
        );
      }
    }
  });
});
