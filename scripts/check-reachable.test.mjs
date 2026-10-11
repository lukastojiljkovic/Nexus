import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import ts from "typescript";

import { auditProgram } from "./check-reachable.mjs";

/**
 * The gate's own verdict, driven in both directions over fixture programs.
 *
 * Its first real run reported fourteen fields, and every one of them had to be
 * read by hand to tell „nobody can reach this“ from „this walk cannot see the
 * shape the form uses" — so the two kinds of evidence it reads (a contextual
 * literal, and a payload assembled through an annotated local) are pinned here
 * rather than trusted, and so is the failure the gate exists for: a field no
 * call site sets is a finding, an allowlisted one is not, and a field a form
 * does fill through either shape must never be reported.
 */

/** The fixture tree mirrors the real one, because the gate's paths are fixed. */
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A tiny program with an `ipc.ts` contract and one renderer file. */
function programFor(rendererSource, contractSource = CONTRACT) {
  const root = mkdtempSync(join(tmpdir(), "nexus-reachable-"));
  roots.push(root);
  const files = {
    "apps/desktop/src/shared/ipc.ts": contractSource,
    "apps/desktop/src/renderer/src/panel.ts": rendererSource,
  };
  const rootNames = [];
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text, "utf8");
    rootNames.push(join(root, path));
  }
  const program = ts.createProgram({
    rootNames,
    options: {
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  });
  return { root, program };
}

/** The five fields the cases below fill, minus the ones they deliberately do not. */
const CONTRACT = `export interface Payload {
  direct?: string;
  shorthand?: string;
  spread?: string;
  neverSet?: string;
  allowlisted?: string;
}

export interface NexusApi {
  save(profileId: string, payload: Payload): Promise<void>;
}
`;

const NEXUS_DECL = `import type { Payload } from "../../shared/ipc.js";

declare const nexus: NexusApi;
`;

/** The bridge the gate recognises: the value's type is `NexusApi` itself. */
const BRIDGE = `import type { NexusApi, Payload } from "../../shared/ipc.js";

declare const nexus: NexusApi;
`;

function fieldsOf(result) {
  return result.unaccounted.map((finding) => finding.key).sort();
}

describe("what counts as a renderer call site", () => {
  it("reads a field written directly, one shorthand, and one a spread carries", () => {
    const { root, program } = programFor(`${BRIDGE}
export async function save(profileId: string): Promise<void> {
  const shorthand = "from the form";
  const carried = { spread: "carried" };
  const payload: Payload = { direct: "written out", shorthand, ...carried };
  await nexus.save(profileId, payload);
}
`);
    const result = auditProgram(program, { repoRoot: root, allowlist: [] });
    // `direct`, `shorthand` and `spread` are evidence, and only the two fields
    // nothing fills are reported.
    expect(fieldsOf(result)).toEqual(["Payload.allowlisted", "Payload.neverSet"]);
  });

  it("reads a payload assembled through an annotated local, which is the house shape", () => {
    const { root, program } = programFor(`${BRIDGE}
export async function save(profileId: string, when: string | null): Promise<void> {
  const fields: Payload = { direct: "d", shorthand: "s", spread: "p" };
  if (when !== null) fields.allowlisted = when;
  await nexus.save(profileId, fields);
}
`);
    const result = auditProgram(program, { repoRoot: root, allowlist: [] });
    expect(fieldsOf(result)).toEqual(["Payload.neverSet"]);
  });

  it("reads an unannotated local at the call site, which no contextual type reaches", () => {
    const { root, program } = programFor(`${BRIDGE}
export async function save(profileId: string): Promise<void> {
  const fields = { direct: "d", shorthand: "s", spread: "p", allowlisted: "a" };
  await nexus.save(profileId, fields);
}
`);
    const result = auditProgram(program, { repoRoot: root, allowlist: [] });
    expect(fieldsOf(result)).toEqual(["Payload.neverSet"]);
  });

  it("only reads an argument of a call on the bridge itself", () => {
    const { root, program } = programFor(`${BRIDGE}
declare const other: { save(profileId: string, payload: Payload): Promise<void> };
export async function save(profileId: string): Promise<void> {
  const fields = { direct: "d", shorthand: "s", spread: "p", neverSet: "n", allowlisted: "a" };
  await other.save(profileId, fields);
}
`);
    const result = auditProgram(program, { repoRoot: root, allowlist: [] });
    // Nothing is credited: the literal carries no contextual type, and a call on
    // something that is not the bridge is not a screen's write to main.
    expect(fieldsOf(result)).toEqual([
      "Payload.allowlisted",
      "Payload.direct",
      "Payload.neverSet",
      "Payload.shorthand",
      "Payload.spread",
    ]);
  });
});

describe("the allowlist", () => {
  const renderer = `${BRIDGE}
export async function save(profileId: string): Promise<void> {
  await nexus.save(profileId, { direct: "d", shorthand: "s", spread: "p" });
}
`;

  it("passes a field it covers, and reports only what is left", () => {
    const { root, program } = programFor(renderer);
    const result = auditProgram(program, {
      repoRoot: root,
      allowlist: [{ type: "Payload", field: "allowlisted", reason: "fixture reason" }],
    });
    expect(fieldsOf(result)).toEqual(["Payload.neverSet"]);
    expect(result.census).toMatchObject({ contractTypes: 1, fields: 5, allowed: 1 });
    expect(result.stale).toEqual([]);
  });

  it("fails an entry whose field a call site now sets", () => {
    const { root, program } = programFor(renderer);
    const result = auditProgram(program, {
      repoRoot: root,
      allowlist: [{ type: "Payload", field: "direct", reason: "fixture reason" }],
    });
    expect(result.stale).toHaveLength(1);
    expect(result.stale[0].detail).toContain("now sets");
  });

  it("fails an entry naming a type or a field the contract does not have", () => {
    const { root, program } = programFor(renderer);
    const result = auditProgram(program, {
      repoRoot: root,
      allowlist: [
        { type: "Vanished", field: "direct", reason: "fixture reason" },
        { type: "Payload", field: "gone", reason: "fixture reason" },
      ],
    });
    expect(result.stale.map((entry) => entry.detail)).toEqual([
      "no contract type named `Vanished`",
      "`Payload` declares no field `gone`",
    ]);
  });
});

describe("a broken walk is not a clean tree", () => {
  it("refuses a program whose contract file declares no NexusApi", () => {
    const { root, program } = programFor(NEXUS_DECL, "export interface Payload { direct: string }\n");
    expect(() => auditProgram(program, { repoRoot: root, allowlist: [] })).toThrow(/NexusApi/);
  });
});
