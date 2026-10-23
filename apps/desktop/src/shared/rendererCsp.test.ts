import { describe, expect, it } from "vitest";

import { rendererCsp } from "./rendererCsp.js";

function directive(policy: string, name: string): string | undefined {
  return policy.split("; ").find((entry) => entry === name || entry.startsWith(name + " "));
}

describe("the renderer CSP", () => {
  it.each(["production", "development"] as const)(
    "admits the Reference frame in %s",
    (mode) => {
      expect(directive(rendererCsp(mode), "frame-src")).toBe("frame-src nx-zim:");
    },
  );

  it("keeps the packaged policy free of development-only sources", () => {
    const policy = rendererCsp("production");

    expect(directive(policy, "script-src")).toBe("script-src 'self'");
    expect(directive(policy, "connect-src")).toBe("connect-src 'self' nx-pack: nx-map:");
    expect(policy).not.toContain("ws://");
  });
});
