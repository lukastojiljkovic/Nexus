// The gate, tested — because a gate nobody has watched fail is indistinguishable
// from a gate that cannot fail, and this one guards the sentence the whole
// professional drawer rests on.
//
// Every fixture below is a small piece of source text rather than a real file:
// the point of each is that the RULE fires, and a fixture that had to be a
// plausible tool would test the fixture.

import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { HOST_WIRING, VERDICT_FIELDS, VERDICT_WORDS, auditAll, readRegistrations } from "./check-risk.mjs";

/** A throwaway repo with exactly the files a case needs, and nothing else. */
function fakeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), "nexus-risk-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text, "utf8");
  }
  return root;
}

const DESKTOP = "apps/desktop/src";
const TOOLS_PAGE = `${DESKTOP}/renderer/src/ToolsPage.tsx`;
const SHARED = `${DESKTOP}/renderer/src/pro/shared.tsx`;
const RISK = `${DESKTOP}/renderer/src/toolRisk.tsx`;
const MODULES = `${DESKTOP}/shared/modules.ts`;

/** The four host lines, present — so a case can leave them alone and test one rule. */
const WIRED = {
  [TOOLS_PAGE]: "<ToolRiskNotice riskClass={selected.riskClass} />\n<ToolRiskProvider value={selected.riskClass}>\n",
  [SHARED]: "const suffix = useCopySuffix();\n",
  [RISK]: "export function ToolRiskNotice({ riskClass }) {}\n",
};

const registration = (id, riskClass, packs) =>
  `  {\n    id: "${id}",\n    category: "structure",\n    riskClass: "${riskClass}",\n    packs: [${packs
    .map((p) => `"${p}"`)
    .join(", ")}],\n  },\n`;

describe("readRegistrations", () => {
  it("reads a tool's id, risk class and packs out of the registration text", () => {
    const root = fakeRepo({ ...WIRED, [MODULES]: registration("beam-check", "life-safety", ["gradnja", "zanat"]) });
    expect(readRegistrations(root)).toEqual([
      { id: "beam-check", riskClass: "life-safety", packs: ["gradnja", "zanat"] },
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("reads a tool that declares no pack — the everyday drawer's eleven", () => {
    const root = fakeRepo({ ...WIRED, [MODULES]: `  {\n    id: "length",\n    riskClass: "none",\n  },\n` });
    expect(readRegistrations(root)).toEqual([{ id: "length", riskClass: "none", packs: [] }]);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("rule 1 — the host still draws the notice", () => {
  it("passes when all four lines are in place", () => {
    const root = fakeRepo({ ...WIRED, [MODULES]: registration("beam-check", "life-safety", ["gradnja"]) });
    expect(auditAll(root).findings).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  for (const wiring of HOST_WIRING) {
    it(`fails when \`${wiring.needle}\` is deleted`, () => {
      const files = { ...WIRED, [MODULES]: registration("beam-check", "life-safety", ["gradnja"]) };
      files[wiring.file] = (files[wiring.file] ?? "").replace(wiring.needle, "/* removed */");
      const root = fakeRepo(files);
      const hits = auditAll(root).findings.filter((f) => f.rule === "host-wiring");
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]?.detail).toContain(wiring.breaks);
      rmSync(root, { recursive: true, force: true });
    });
  }

  it("fails when the notice component's file is gone entirely", () => {
    const files = { ...WIRED, [MODULES]: registration("beam-check", "life-safety", ["gradnja"]) };
    delete files[RISK];
    const root = fakeRepo(files);
    expect(auditAll(root).findings.some((f) => f.rule === "host-wiring")).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("rule 2 — no verdict in the copy of a tool that may not render one", () => {
  const copy = (id, value) =>
    `export const PRO_GRADNJA_SR = {\n  "${id}": {\n    result: "${value}",\n  },\n} as const;\n`;

  it("fails on a life-safety tool whose copy says the value complies", () => {
    const root = fakeRepo({
      ...WIRED,
      [MODULES]: registration("beam-check", "life-safety", ["gradnja"]),
      [`${DESKTOP}/renderer/src/strings/pro.gradnja.ts`]: copy("beam-check", "Presek zadovoljava."),
    });
    const hits = auditAll(root).findings.filter((f) => f.rule === "verdict-copy");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.detail).toContain("beam-check");
    rmSync(root, { recursive: true, force: true });
  });

  it("fails on a food-safety tool the same way", () => {
    const root = fakeRepo({
      ...WIRED,
      [MODULES]: registration("brine-salt", "food-safety", ["kuhinja"]),
      [`${DESKTOP}/renderer/src/strings/pro.kuhinja.ts`]: copy("brine-salt", "Salamura je bezbedna."),
    });
    expect(auditAll(root).findings.some((f) => f.rule === "verdict-copy")).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("says nothing about the same sentence under a tool that MAY judge", () => {
    const root = fakeRepo({
      ...WIRED,
      [MODULES]: registration("late-payment-interest", "financial", ["gradnja"]),
      [`${DESKTOP}/renderer/src/strings/pro.gradnja.ts`]: copy("late-payment-interest", "Iznos zadovoljava uslov."),
    });
    expect(auditAll(root).findings.filter((f) => f.rule === "verdict-copy")).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("attributes the word to the tool whose block it sits in, not to the file", () => {
    const text =
      `export const PRO_GRADNJA_SR = {\n` +
      `  "safe-tool": {\n    a: "Sve je u redu.",\n  },\n` +
      `  "beam-check": {\n    b: "U granicama.",\n  },\n` +
      `} as const;\n`;
    const root = fakeRepo({
      ...WIRED,
      [MODULES]: registration("safe-tool", "life-safety", ["gradnja"]) + registration("beam-check", "life-safety", ["gradnja"]),
      [`${DESKTOP}/renderer/src/strings/pro.gradnja.ts`]: text,
    });
    const hits = auditAll(root).findings.filter((f) => f.rule === "verdict-copy");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.detail).toContain("beam-check");
    rmSync(root, { recursive: true, force: true });
  });

  it("leaves ordinary Serbian alone — a quantity, a unit and the user's own limit", () => {
    const root = fakeRepo({
      ...WIRED,
      [MODULES]: registration("beam-check", "life-safety", ["gradnja"]),
      [`${DESKTOP}/renderer/src/strings/pro.gradnja.ts`]:
        `export const PRO_GRADNJA_SR = {\n  "beam-check": {\n` +
        `    a: "Najveći ugib",\n    b: "Granica koju si uneo",\n    c: "Odnos prema tvojoj granici",\n` +
        `    d: "Pad napona na vodu",\n    e: "Poslednja pozicija pada tačno na kraj.",\n` +
        `  },\n} as const;\n`,
    });
    expect(auditAll(root).findings).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("rule 3 — no verdict in the arithmetic", () => {
  it("fails on a boolean that decides", () => {
    const root = fakeRepo({
      ...WIRED,
      [MODULES]: registration("beam-check", "life-safety", ["gradnja"]),
      "packages/core/src/pro/gradnja.ts": "export interface Beam {\n  readonly passes: boolean;\n}\n",
    });
    const hits = auditAll(root).findings.filter((f) => f.rule === "verdict-field");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.line).toBe(2);
    rmSync(root, { recursive: true, force: true });
  });

  it("leaves `ok` alone — it is ProResult's discriminant, not a judgement", () => {
    const root = fakeRepo({
      ...WIRED,
      [MODULES]: registration("beam-check", "life-safety", ["gradnja"]),
      "packages/core/src/pro/gradnja.ts": "export interface F {\n  readonly ok: false;\n}\n",
    });
    expect(auditAll(root).findings.filter((f) => f.rule === "verdict-field")).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("catches the whole banned vocabulary and nothing outside it", () => {
    for (const name of ["passes", "compliant", "conforms", "acceptable", "isSafe", "withinLimit", "verdict"]) {
      expect(VERDICT_FIELDS.test(`  readonly ${name}: boolean;`), name).toBe(true);
    }
    for (const name of ["ok", "hasLanding", "isCantilever", "usesFlushTop"]) {
      expect(VERDICT_FIELDS.test(`  readonly ${name}: boolean;`), name).toBe(false);
    }
    // A quantity named after the same idea is not a verdict — only the boolean is.
    expect(VERDICT_FIELDS.test("  readonly safeLoad: number;")).toBe(false);
  });
});

describe("the vocabulary itself", () => {
  it("names a reason for every word, so a red run says why and not just what", () => {
    for (const word of VERDICT_WORDS) {
      expect(typeof word.why, String(word.re)).toBe("string");
      expect(word.why.length, String(word.re)).toBeGreaterThan(20);
    }
  });

  it("does not fire on the words a careful tool legitimately uses", () => {
    const innocent = [
      "Pad napona",
      "Granica koju si uneo",
      "Približno 12,5 mm",
      "Tačno na kraju korisne dužine",
      "Odnos prema tvojoj granici",
      "Nosivost prema tvojoj vrednosti",
    ];
    for (const text of innocent) {
      for (const word of VERDICT_WORDS) expect(word.re.test(text), `${text} vs ${word.re}`).toBe(false);
    }
  });
});

describe("the real repository", () => {
  it("has its notice wiring intact and no judgement anywhere", () => {
    const { findings, toolCount, forbiddenCount } = auditAll();
    expect(findings, JSON.stringify(findings, null, 1)).toEqual([]);
    expect(toolCount).toBeGreaterThan(50);
    expect(forbiddenCount).toBeGreaterThan(0);
  });
});
