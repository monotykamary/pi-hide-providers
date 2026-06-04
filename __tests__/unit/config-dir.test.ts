import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Verify that hide-providers.ts uses getAgentDir from pi-coding-agent
// instead of hardcoding ~/.pi/agent via homedir().

describe("config dir uses getAgentDir", () => {
  it("imports getAgentDir from @earendil-works/pi-coding-agent", () => {
    const srcPath = join(process.cwd(), "hide-providers.ts");
    const source = readFileSync(srcPath, "utf8");

    // Must have a value import of getAgentDir from pi-coding-agent
    expect(source).toMatch(
      /import\s*\{[^}]*getAgentDir[^}]*\}\s*from\s*["']@earendil-works\/pi-coding-agent["']/,
    );

    // Must call getAgentDir() for the config dir
    expect(source).toMatch(/getAgentDir\(\)/);

    // Must NOT import homedir from node:os
    expect(source).not.toMatch(
      /import\s*\{[^}]*homedir[^}]*\}\s*from\s*["']node:os["']/,
    );

    // Must NOT hardcode ".pi" and "agent" in a join() call
    expect(source).not.toMatch(
      /join\s*\([^)]*["']\.pi["'][^)]*["']agent["']/,
    );
    expect(source).not.toMatch(
      /join\s*\([^)]*["']agent["'][^)]*["']\.pi["']/,
    );
  });
});
