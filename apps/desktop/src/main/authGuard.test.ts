import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ownerGuardPath, readOwnerGuard, writeOwnerGuard } from "./authGuard.js";

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "nexus-auth-guard-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the owner-only account guard", () => {
  it("is absent until written, then round-trips with mode 0600", () => {
    const dir = scratch();
    expect(readOwnerGuard(dir)).toBeNull();
    writeOwnerGuard(dir, "secret");
    expect(readOwnerGuard(dir)).toBe("secret");
    if (process.platform !== "win32") {
      expect(statSync(ownerGuardPath(dir)).mode & 0o777).toBe(0o600);
    }
  });

  it("tightens an existing file that was made too permissive", () => {
    const dir = scratch();
    const path = ownerGuardPath(dir);
    writeFileSync(path, "old", { mode: 0o644 });
    chmodSync(path, 0o644);
    writeOwnerGuard(dir, "new");
    expect(readFileSync(path, "utf8")).toBe("new");
    if (process.platform !== "win32") {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
  });

  it("refuses a symlink instead of following it", () => {
    if (process.platform === "win32") return;
    const dir = scratch();
    const target = join(dir, "elsewhere");
    writeFileSync(target, "do not read");
    symlinkSync(target, ownerGuardPath(dir));
    expect(() => readOwnerGuard(dir)).toThrow(/regular file/);
    expect(() => writeOwnerGuard(dir, "secret")).toThrow(/regular file/);
  });
});
